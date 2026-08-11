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

// Load every cached image. The viewer only ever sees a directory of files.
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
const CELL_ASPECT = 1 // cell width : height in pixels; square cells, all photos cover-cropped to this

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

let cols = 1
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

const cellBoxes: BoxRenderable[] = []
let contentBox: BoxRenderable | null = null

function updateHeader() {
  header.content = `phototui - ${images.length} photos - arrows to move, enter to open, q to quit`
}

function computeCols() {
  const maxCols = Math.max(1, Math.floor(renderer.width / COL_MIN_WIDTH))
  cols = Math.min(maxCols, images.length)
}

// Base cell width (cols cells + gaps fit within the terminal width), plus the
// leftover columns spread across the first cells of each row so every row
// fills the full width edge-to-edge instead of leaving a ragged gap.
function baseCellWidth() {
  return Math.max(1, Math.floor((renderer.width - (cols - 1) * GAP) / cols))
}

function leftoverCols() {
  const w = renderer.width
  const used = cols * baseCellWidth() + (cols - 1) * GAP
  return Math.max(0, w - used)
}

function cellWidth(col: number) {
  return baseCellWidth() + (col < leftoverCols() ? 1 : 0)
}

function cellHeight() {
  // CELL_ASPECT is the desired cell shape in *pixels* (width : height). Because
  // terminal cells are taller than they are wide, we divide by cellAspectRatio
  // so a landscape cell stays landscape in pixels and landscape photos
  // aren't cropped into portrait.
  return Math.max(1, Math.round(baseCellWidth() / (CELL_ASPECT * cellAspectRatio())))
}

function highlight() {
  cellBoxes.forEach((cell, i) => {
    cell.border = i === selected
    cell.borderColor = i === selected ? "#f38ba8" : "transparent"
  })
  grid.scrollTo({ x: 0, y: Math.floor(selected / cols) * (cellHeight() + GAP) })
}

function rebuildGrid() {
  contentBox?.destroyRecursively()
  cellBoxes.length = 0

  contentBox = new BoxRenderable(renderer, {
    id: "grid-content",
    width: "100%",
    flexDirection: "column",
    flexShrink: 0,
  })
  grid.content.add(contentBox)

  const h = cellHeight()

  for (let start = 0; start < images.length; start += cols) {
    const row = new BoxRenderable(renderer, {
      id: `row-${start}`,
      width: "100%",
      flexDirection: "row",
      flexShrink: 0,
      marginBottom: GAP,
    })
    contentBox.add(row)

    for (let i = start; i < Math.min(start + cols, images.length); i++) {
      const { file, source } = images[i]!
      const col = i % cols
      const cell = new BoxRenderable(renderer, {
        id: `cell-${i}`,
        width: cellWidth(col),
        height: h,
        flexShrink: 0,
        marginRight: col === cols - 1 || i === images.length - 1 ? 0 : GAP,
        borderStyle: "rounded",
        border: false,
      })
      row.add(cell)

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

      cellBoxes.push(cell)
    }
  }

  selected = Math.min(selected, images.length - 1)
  highlight()
}

function move(dx: number, dy: number) {
  const row = Math.floor(selected / cols)
  const col = selected % cols
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
  computeCols()
  selected = Math.min(selected, images.length - 1)
  rebuildGrid()
})

// Per-frame logging (toggle with f). Writes a timestamped line to stderr on
// every rendered frame so the rate can be measured outside the overlay.
let frameLogging = false
let lastFrame = 0
renderer.on("frame", () => {
  if (!frameLogging) return
  const now = performance.now()
  const delta = lastFrame ? now - lastFrame : 0
  lastFrame = now
  process.stderr.write(`frame t=${now.toFixed(1)}ms dt=${delta.toFixed(1)}ms\n`)
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
computeCols()
rebuildGrid()
renderer.start()

process.once("SIGINT", () => {
  renderer.destroy()
  process.exit(0)
})
