#!/usr/bin/env bun

import {
  BoxRenderable,
  ConsolePosition,
  ImageRenderable,
  NativeImage,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core"
import { readdirSync, statSync } from "node:fs"
import { availableParallelism } from "node:os"
import { resolve, join, basename } from "node:path"
import { DecodePool, type DecodeHandle } from "./decode-pool.ts"

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
//
// Source: a directory argument (`bun src/index.ts ~/Pictures`) walked
// recursively, defaulting to the Unsplash sample cache for `bun run start`.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i
const SOURCE_DIR = resolve(process.argv[2] ?? CACHE_DIR)

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(path, out)
    else if (IMAGE_EXT.test(name)) out.push(path)
  }
}

const files: string[] = []
if (statSync(SOURCE_DIR, { throwIfNoEntry: false })?.isDirectory()) walk(SOURCE_DIR, files)
const images = files
  .sort()
  .map((path) => ({ file: basename(path), source: path }))

if (images.length === 0) {
  console.error(
    `no images in ${SOURCE_DIR} - run \`bun run fetch\` for the sample set, ` +
      "or pass a directory: `bun src/index.ts ~/Pictures`",
  )
  process.exit(1)
}

const GAP = 1
const COL_MIN_WIDTH = 16
const CELL_ASPECT = 1 // cell width : height in pixels; square cells, cover-cropped
const PREFETCH_ROWS = 4 // minimum extra rows prefetched once the selection nears an edge (scales with terminal height)

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 60,

  gatherStats: true,
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

function dumpStats() {
  const s = renderer.getStats()
  process.stderr.write(
    `stats live=${cells.size} lastFrame=${s.nativeLastFrameTime.toFixed(2)}ms ` +
      `avgFrame=${s.nativeAverageFrameTime.toFixed(2)}ms ` +
      `render=${(s.nativeRenderTime ?? 0).toFixed(2)}ms ` +
      `stdout=${(s.nativeStdoutWriteTime ?? 0).toFixed(2)}ms ` +
      `cells=${s.cellsUpdated} avgCells=${s.averageCellsUpdated} frames=${s.nativeFrameCount}\n`,
  )
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

// Pixel size of a cell (col c, cellH rows) so the worker can downscale the
// decoded image to exactly what the terminal will draw. Returns [0, 0] when
// the terminal reports no pixel geometry (no downscale then).
function cellPixelSize(col: number): [number, number] {
  const res = renderer.resolution
  if (!res || renderer.width <= 0 || renderer.height <= 0) return [0, 0]
  const pxPerCol = res.width / renderer.width
  const pxPerRow = res.height / renderer.height
  return [Math.max(1, Math.round(colWidths[col]! * pxPerCol)), Math.max(1, Math.round(cellH * pxPerRow))]
}

// --- Virtualization ------------------------------------------------------

// Only cells within the visible window (plus a buffer) are alive; the rest
// are destroyed so their decoded images are freed.
interface DecodedPixels {
  rgba: Uint8Array
  width: number
  height: number
  stride: number
}
interface LiveCell {
  box: BoxRenderable
  image: ImageRenderable
  spinner: TextRenderable | null
  loading: boolean
  visible: boolean
  pendingPixels: DecodedPixels | null
  handle: DecodeHandle | null
}
const cells = new Map<number, LiveCell>()
let contentBox: BoxRenderable | null = null

// Decode workers so image decoding runs off the main/render thread. Sized to
// the available cores, capped so we don't spawn dozens for tiny galleries.
const decodePool = new DecodePool(Math.min(8, Math.max(2, availableParallelism())))

// Upload decoded pixels into a cell's ImageRenderable. Only called for cells
// actually on screen (see applyDecoded); prefetched cells hold their pixels
// until they scroll into view.
function queueApply(cell: LiveCell, img: DecodedPixels) {
  const image = cell.image
  const spinner = cell.spinner
  ;(image as unknown as { _image: NativeImage | null })._image =
    NativeImage.fromRgba(img.rgba, img.width, img.height, img.stride)
  ;(image as unknown as { requestRender: () => void }).requestRender()
  if (spinner) spinner.visible = false
  cell.loading = false
}

function applyDecoded(cell: LiveCell, img: DecodedPixels | null) {
  if (cell.image.isDestroyed) return
  if (!img) {
    // Decode failed: drop the spinner, leave the cell empty.
    cell.loading = false
    if (cell.spinner) cell.spinner.visible = false
    return
  }
  // Only upload images for cells actually on screen. Prefetched (off-screen)
  // cells just hold their decoded pixels; they get uploaded when they scroll
  // into view. This keeps the terminal from receiving image bytes for cells
  // the user can't see yet - the stdout write is the real frame-time cost.
  if (!cell.visible) {
    cell.pendingPixels = img
    cell.loading = false
    if (cell.spinner) cell.spinner.visible = false
    return
  }
  queueApply(cell, img)
}

function createCell(i: number): LiveCell {
  const col = colOf(i)
  const box = new BoxRenderable(renderer, {
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
  // source: undefined so OpenTUI does not decode on the main thread; we feed
  // it the already-decoded RGBA from a worker instead.
  const image = new ImageRenderable(renderer, {
    id: `thumb-${i}`,
    source: undefined,
    width: "100%",
    height: "100%",
    fit: "cover",
    protocol: "auto",
  })
  box.add(image)
  // Per-cell loading spinner: visible while the decode is pending (real
  // albums decode off-thread on first pass, so cells pop in asynchronously).
  const spinner = new TextRenderable(renderer, {
    id: `spinner-${i}`,
    content: "⠋",
    position: "absolute",
    left: Math.max(0, Math.floor((colWidths[col]! - 1) / 2)),
    top: Math.max(0, Math.floor((cellH - 1) / 2)),
    selectable: false,
  })
  box.add(spinner)
  contentBox!.add(box)
  const cell: LiveCell = { box, image, spinner, loading: true, visible: false, pendingPixels: null, handle: null }
  // Downscale in the worker to the cell's pixel size so the main thread
  // uploads a tiny image and the terminal receives far fewer bytes per cell
  // (the stdout write is the real frame-time cost, not the render pass).
  const [tw, th] = cellPixelSize(col)
  // Reuse a cached decode if we have one (scrolling back up/down should not
  // re-decode from disk); otherwise decode via the worker pool.
  const cached = decodePool.getCached(source, tw, th)
  if (cached) {
    applyDecoded(cell, cached)
  } else {
    cell.handle = decodePool.decode(source, tw, th, (decoded: { rgba: Uint8Array; width: number; height: number; stride: number } | null) => {
      if (decoded === null) console.error(`failed to load ${file}`)
      applyDecoded(cell, decoded)
    })
  }
  return cell
}

function destroyCell(i: number) {
  const cell = cells.get(i)
  if (!cell) return
  cell.handle?.cancel() // drop a still-pending decode result
  cell.box.destroyRecursively() // disposes the injected NativeImage
  cells.delete(i)
}

function visibleRange() {
  const top = grid.scrollTop
  const viewH = grid.viewport.height
  const stride = cellH + GAP
  // How many image-rows are visible depends on the viewport height, so the
  // prefetch scales with the terminal instead of being a fixed row count.
  const visibleRows = viewH > 0 ? Math.max(1, Math.ceil(viewH / stride)) : 1
  // Prefetch below the fold so scrolling down never waits on a decode: at
  // least 2 rows, or a full page on taller terminals. Above stays modest.
  const below = Math.max(2, visibleRows)
  const above = Math.max(2, Math.round(visibleRows / 2))
  const prefetch = Math.max(PREFETCH_ROWS, visibleRows)
  let firstRow = Math.max(0, Math.floor((top - above * stride) / stride))
  let lastRow = Math.ceil((top + viewH + below * stride) / stride)

  // Prefetch ahead of the selection: once the selected row nears the
  // visible bottom (or top), extend the live window a few rows further in
  // that direction so the next cells are already decoded when you move.
  // Compared in row indices so it stays correct for small viewports.
  if (viewH > 0) {
    const selRow = rowOf(selected)
    const topRow = Math.floor(top / stride)
    const bottomRow = Math.ceil((top + viewH) / stride)
    // Extend ahead of the selection only when it sits on (or past) the
    // visible edge: last visible row -> prefetch below, first visible row
    // -> prefetch above.
    if (selRow >= bottomRow - 1) lastRow += prefetch
    if (selRow <= topRow + 1) firstRow = Math.max(0, firstRow - prefetch)
  }

  const first = firstRow * cols
  const last = Math.min(images.length, lastRow * cols + cols) - 1
  return [Math.max(0, first), Math.max(0, last)] as const
}

let dirty = true
let lastScrollTop = -1
let lastWidth = -1
let lastHeight = -1

// The cell index range actually within the viewport (not the prefetch
// window). Only these cells upload images to the terminal; prefetched cells
// hold their decoded pixels until they scroll into view.
function visibleCellRange(): [number, number] {
  const top = grid.scrollTop
  const viewH = grid.viewport.height
  const stride = cellH + GAP
  const firstRow = Math.max(0, Math.floor(top / stride))
  const lastRow = Math.max(firstRow, Math.ceil((top + viewH) / stride) - 1)
  const first = firstRow * cols
  const last = Math.min(images.length, lastRow * cols + cols) - 1
  return [Math.max(0, first), Math.max(0, last)]
}

function reconcile() {
  if (!contentBox) return
  const [first, last] = visibleRange()
  const [visFirst, visLast] = visibleCellRange()

  // Destroy cells that have left the window.
  for (const i of [...cells.keys()]) {
    if (i < first || i > last) destroyCell(i)
  }
  // Create cells that have entered the window.
  for (let i = first; i <= last; i++) {
    if (!cells.has(i)) cells.set(i, createCell(i))
  }
  // Update visibility flags and upload any cell that just scrolled into view
  // and already has decoded pixels waiting.
  for (const [i, cell] of cells) {
    const vis = i >= visFirst && i <= visLast
    if (vis && !cell.visible && cell.pendingPixels) {
      const px = cell.pendingPixels
      cell.pendingPixels = null
      queueApply(cell, px)
    }
    cell.visible = vis
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
  // the border shows, then reconcile.
  if (!cells.has(selected)) cells.set(selected, createCell(selected))
  for (const [i, cell] of cells) {
    cell.box.border = i === selected
    cell.box.borderColor = i === selected ? "#f38ba8" : "transparent"
  }

  // Only scroll to keep the selection on screen: nudge when it crosses the
  // bottom edge, snap up when it crosses the top. Stay put otherwise, so
  // moving within the viewport doesn't yank the scroll position. Skip until
  // the viewport has a real height (layout not settled yet).
  const viewH = grid.viewport.height
  if (viewH > 0) {
    const stride = cellH + GAP
    const selTop = cellTop(selected)
    const selBottom = selTop + cellH
    const viewTop = grid.scrollTop
    const viewBottom = viewTop + viewH
    let target = viewTop
    if (selBottom > viewBottom) target = selBottom - viewH
    else if (selTop < viewTop) target = selTop
    const max = Math.max(0, totalHeight - viewH)
    target = Math.max(0, Math.min(max, target))
    if (target !== viewTop) grid.scrollTo({ x: 0, y: target })
  }
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

// Allow headless frame-rate measurement: OTUI_FRAME_LOG=1 starts with frame
// logging on, so `bun src/index.ts` can be piped to a file and the inter-frame
// deltas measured without pressing `f`.
if (process.env.OTUI_FRAME_LOG === "1") frameLogging = true

// Animate the per-cell loading spinners. Only touches cells still loading,
// and only a few times per second, so it stays cheap.
const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinnerTick = 0
setInterval(() => {
  spinnerTick++
  const ch = SPINNER_CHARS[spinnerTick % SPINNER_CHARS.length]!
  for (const cell of cells.values()) {
    if (cell.loading && cell.spinner) cell.spinner.content = ch
  }
}, 100)

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
    case "b":
      // Dump a one-shot render-stats breakdown to stderr so we can tell
      // whether a frame drop is the render pass or the stdout write.
      dumpStats()
      break
    case "q":
    case "escape":
      decodePool.destroy()
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
  decodePool.destroy()
  renderer.destroy()
  process.exit(0)
})