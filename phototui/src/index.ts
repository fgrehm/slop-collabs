#!/usr/bin/env bun

import {
  BoxRenderable,
  ConsolePosition,
  ImageRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"

const CACHE_DIR = resolve(import.meta.dir, "..", "cache")

// Zellij versions before the 2026-07-31 kitty-graphics merge only forward
// Sixel, which Ghostty (and many terminals) don't render. Bail with a clear
// message rather than show nothing or an ugly block fallback.
if (process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ_PANE_ID) {
  console.error(
    "phototui can't render native images inside Zellij yet: this Zellij build " +
      "only forwards Sixel, and your terminal doesn't support it.\n" +
      "Run phototui in a plain terminal tab instead (Ghostty handles Kitty graphics natively).",
  )
  process.exit(1)
}

// Only image metadata is held in memory; renderables are created on demand
// for the visible window and destroyed when they scroll away, so a large
// gallery doesn't keep every decoded image alive.
const images = readdirSync(CACHE_DIR)
  .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
  .sort()
  .map((file) => ({ file, source: resolve(CACHE_DIR, file) }))

if (images.length === 0) {
  console.error("no images in ./cache - run `bun run fetch` first")
  process.exit(1)
}

const GAP = 1
const COL_MIN_WIDTH = 16
const CELL_ASPECT = 1 // cell width : height in pixels; square cells, cover-cropped
const BUFFER_ROWS = 3 // rows kept alive above/below the viewport for smooth scrolling

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
  consoleOptions: { position: ConsolePosition.BOTTOM },
})

// Cell aspect ratio (cell height / cell width in pixels) so we can convert a
// desired pixel cell shape into the right number of terminal rows. Defaults
// to 2 (the OpenTUI default) when the terminal doesn't report pixel geometry.
function cellAspectRatio() {
  const res = renderer.resolution
  if (!res || renderer.width <= 0 || renderer.height <= 0) return 2
  return (res.height / renderer.height) / (res.width / renderer.width)
}

let selected = 0

const root = new BoxRenderable(renderer, {
  id: "root",
  width: "100%",
  height: "100%",
  flexDirection: "column",
  flexShrink: 0,
})
renderer.root.add(root)

const header = new TextRenderable(renderer, {
  id: "header",
  content: "",
  width: "100%",
  height: 1,
  flexShrink: 0,
  wrapMode: "none",
  selectable: false,
  paddingLeft: 1,
})
root.add(header)

const grid = new ScrollBoxRenderable(renderer, {
  id: "grid",
  width: "100%",
  height: "100%",
  flexGrow: 1,
  flexShrink: 1,
  scrollY: true,
  stickyScroll: false,
  viewportCulling: true,
})
root.add(grid)

// Full-screen viewer overlay, hidden until the user opens a photo.
const viewer = new BoxRenderable(renderer, {
  id: "viewer",
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  flexDirection: "column",
  backgroundColor: "#000000",
  visible: false,
  zIndex: 10,
})
renderer.root.add(viewer)

const viewerHeader = new TextRenderable(renderer, {
  id: "viewer-header",
  content: "",
  width: "100%",
  height: 1,
  flexShrink: 0,
  wrapMode: "none",
  selectable: false,
  paddingLeft: 1,
})
viewer.add(viewerHeader)

const viewerImage = new ImageRenderable(renderer, {
  id: "viewer-image",
  source: undefined,
  width: "100%",
  height: "100%",
  flexGrow: 1,
  fit: "fit",
  protocol: "auto",
})
viewer.add(viewerImage)

let viewerOpen = false

function showViewerImage() {
  viewerHeader.content =
    `${images[selected]!.file} (${selected + 1}/${images.length}) - left/right to move, escape to return`
  viewerImage.source = images[selected]!.source
}

function openViewer() {
  viewerOpen = true
  viewer.visible = true
  showViewerImage()
}

function closeViewer() {
  viewerOpen = false
  viewer.visible = false
  highlight()
}

function updateHeader() {
  header.content = `phototui - ${images.length} photos - arrows to move, enter to open, q to quit`
}

// --- Grid geometry -------------------------------------------------------

// Grid metrics, recomputed on resize. cols is the column count; colWidths[c]
// and colLefts[c] give each column's width and x offset (leftover columns
// spread the remainder so rows fill the full width); cellH is the row height
// in terminal rows; totalHeight is the full scrollable height.
let cols = 1
let cellH = 1
let totalHeight = 1
let colWidths: number[] = []
let colLefts: number[] = []

function computeGrid() {
  const maxCols = Math.max(1, Math.floor(renderer.width / COL_MIN_WIDTH))
  cols = Math.min(maxCols, images.length)
  if (cols < 1) cols = 1

  const base = Math.max(1, Math.floor((renderer.width - (cols - 1) * GAP) / cols))
  const leftover = Math.max(0, renderer.width - (cols * base + (cols - 1) * GAP))
  colWidths = []
  colLefts = []
  let x = 0
  for (let c = 0; c < cols; c++) {
    colWidths.push(base + (c < leftover ? 1 : 0))
    colLefts.push(x)
    x += colWidths[c]! + GAP
  }
  cellH = Math.max(1, Math.round(base / (CELL_ASPECT * cellAspectRatio())))
  const rows = Math.ceil(images.length / cols)
  totalHeight = rows * cellH + (rows - 1) * GAP
}

function rowOf(i: number) {
  return Math.floor(i / cols)
}
function colOf(i: number) {
  return i % cols
}
function cellTop(i: number) {
  return rowOf(i) * (cellH + GAP)
}

// --- Virtualization ------------------------------------------------------

// Only cells within the visible window (plus a buffer) are alive; the rest
// are destroyed so their decoded images are freed.
const cells = new Map<number, BoxRenderable>()
let contentBox: BoxRenderable | null = null

function createCell(i: number): BoxRenderable {
  const col = colOf(i)
  const cell = new BoxRenderable(renderer, {
    id: `cell-${i}`,
    position: "absolute",
    left: colLefts[col]!,
    top: cellTop(i),
    width: colWidths[col]!,
    height: cellH,
    borderStyle: "rounded",
    border: i === selected,
    borderColor: i === selected ? "#f38ba8" : "transparent",
  })
  const { file, source } = images[i]!
  const image = new ImageRenderable(renderer, {
    id: `thumb-${i}`,
    source,
    width: "100%",
    height: "100%",
    fit: "cover",
    protocol: "auto",
    onError: (err) => console.error(`failed to load ${file}:`, err),
  })
  cell.add(image)
  contentBox!.add(cell)
  return cell
}

function destroyCell(i: number) {
  const cell = cells.get(i)
  if (!cell) return
  cell.destroyRecursively() // disposes the decoded NativeImage
  cells.delete(i)
}

function visibleRange() {
  const top = grid.scrollTop
  const viewH = grid.viewport.height
  const firstRow = Math.max(0, Math.floor((top - BUFFER_ROWS * (cellH + GAP)) / (cellH + GAP)))
  const lastRow = Math.ceil((top + viewH + BUFFER_ROWS * (cellH + GAP)) / (cellH + GAP))
  const first = firstRow * cols
  const last = Math.min(images.length, lastRow * cols + cols) - 1
  return [Math.max(0, first), Math.max(0, last)] as const
}

let dirty = true
let lastScrollTop = -1
let lastWidth = -1
let lastHeight = -1

function reconcile() {
  if (!contentBox) return
  const [first, last] = visibleRange()

  // Destroy cells that have left the window.
  for (const i of [...cells.keys()]) {
    if (i < first || i > last) destroyCell(i)
  }
  // Create cells that have entered the window.
  for (let i = first; i <= last; i++) {
    if (!cells.has(i)) cells.set(i, createCell(i))
  }
}

function rebuildGrid() {
  // Destroy every live cell and the content box, then rebuild the content
  // box at the full scrollable height so the scrollbar range is correct even
  // though only a sparse set of cells is alive at any time.
  for (const i of [...cells.keys()]) destroyCell(i)
  contentBox?.destroyRecursively()
  cells.clear()

  contentBox = new BoxRenderable(renderer, {
    id: "grid-content",
    position: "relative",
    width: "100%",
    height: totalHeight,
    flexShrink: 0,
  })
  grid.content.add(contentBox)

  lastScrollTop = -1
  dirty = true
  reconcile()
  highlight()
}

function highlight() {
  // The selected cell may be off-screen and not alive; ensure it exists so
  // the border shows after we scroll it into view, then reconcile.
  if (!cells.has(selected)) cells.set(selected, createCell(selected))
  for (const [i, cell] of cells) {
    cell.border = i === selected
    cell.borderColor = i === selected ? "#f38ba8" : "transparent"
  }
  grid.scrollTo({ x: 0, y: cellTop(selected) })
  dirty = true
}

function move(dx: number, dy: number) {
  const row = rowOf(selected)
  const col = colOf(selected)
  let ncol = col + dx
  let nrow = row + dy
  if (ncol < 0) {
    ncol = cols - 1
    nrow -= 1
  } else if (ncol >= cols) {
    ncol = 0
    nrow += 1
  }
  if (nrow < 0 || nrow >= Math.ceil(images.length / cols)) return
  const idx = nrow * cols + ncol
  if (idx < 0 || idx >= images.length) return
  selected = idx
}

renderer.on("resize", () => {
  computeGrid()
  selected = Math.min(selected, images.length - 1)
  rebuildGrid()
})

// Per-frame logging (toggle with f). Writes a timestamped line to stderr on
// every rendered frame so the rate can be measured outside the overlay.
let frameLogging = false
let lastFrame = 0
renderer.on("frame", () => {
  if (frameLogging) {
    const now = performance.now()
    const delta = lastFrame ? now - lastFrame : 0
    lastFrame = now
    process.stderr.write(`frame t=${now.toFixed(1)}ms dt=${delta.toFixed(1)}ms\n`)
  }

  // Reconcile the virtualized grid when the scroll position or terminal
  // size has changed (or when something explicitly marked it dirty, e.g.
  // selection). Avoids work on idle frames.
  if (viewerOpen) return
  const top = grid.scrollTop
  if (dirty || top !== lastScrollTop || renderer.width !== lastWidth || renderer.height !== lastHeight) {
    dirty = false
    lastScrollTop = top
    lastWidth = renderer.width
    lastHeight = renderer.height
    reconcile()
  }
})

renderer.keyInput.on("keypress", (key) => {
  if (viewerOpen) {
    switch (key.name) {
      case "left":
      case "h":
        selected = (selected - 1 + images.length) % images.length
        showViewerImage()
        break
      case "right":
      case "l":
        selected = (selected + 1) % images.length
        showViewerImage()
        break
      case "escape":
      case "q":
      case "backspace":
        closeViewer()
        break
    }
    return
  }

  switch (key.name) {
    case "left":
    case "h":
      move(-1, 0)
      highlight()
      break
    case "right":
    case "l":
      move(1, 0)
      highlight()
      break
    case "up":
    case "k":
      move(0, -1)
      highlight()
      break
    case "down":
    case "j":
      move(0, 1)
      highlight()
      break
    case "return":
    case "kpenter":
    case "o":
    case "space":
      openViewer()
      break
    case "d":
      // Toggle OpenTUI's built-in overlay: live FPS + memory.
      renderer.toggleDebugOverlay()
      break
    case "f":
      // Toggle per-frame timestamps to stderr so you can measure frame rate
      // outside the overlay (e.g. `bun src/index.ts 2>frames.log`).
      frameLogging = !frameLogging
      header.content =
        `phototui - ${images.length} photos - frame log ${frameLogging ? "ON" : "OFF"} - d overlay, q to quit`
      break
    case "q":
    case "escape":
      renderer.destroy()
      process.exit(0)
      break
  }
})

updateHeader()
computeGrid()
rebuildGrid()
renderer.start()

process.once("SIGINT", () => {
  renderer.destroy()
  process.exit(0)
})