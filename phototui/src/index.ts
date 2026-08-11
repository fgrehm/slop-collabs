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

// Grid tuning. A 3:2 cell keeps thumbnails looking like photos.
const CELL_MIN_WIDTH = 16
const GAP = 1
const CELL_ASPECT = 3 / 2 // width : height

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
  consoleOptions: { position: ConsolePosition.BOTTOM },
})

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

const cellBoxes: BoxRenderable[] = []
let contentBox: BoxRenderable | null = null

function updateHeader() {
  header.content = `phototui - ${images.length} photos - arrows to move, q to quit`
}

function computeCols() {
  const width = renderer.width
  const maxCols = Math.max(1, Math.floor(width / CELL_MIN_WIDTH))
  cols = Math.min(maxCols, images.length)
  if (cols < 1) cols = 1
}

function cellWidth() {
  return Math.max(1, Math.floor((renderer.width - (cols - 1) * GAP) / cols))
}

function cellHeight() {
  return Math.max(1, Math.round(cellWidth() / CELL_ASPECT))
}

function highlight() {
  cellBoxes.forEach((cell, i) => {
    cell.border = i === selected
    cell.borderColor = i === selected ? "#f38ba8" : "transparent"
  })
  grid.scrollTo({ x: 0, y: Math.floor(selected / cols) * (cellHeight() + GAP) })
}

function rebuildGrid() {
  // Tear down the previous grid content so we start fresh on resize.
  contentBox?.destroyRecursively()
  cellBoxes.length = 0

  contentBox = new BoxRenderable(renderer, {
    id: "grid-content",
    width: "100%",
    flexDirection: "column",
    flexShrink: 0,
  })
  grid.content.add(contentBox)

  const w = cellWidth()
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
      const cell = new BoxRenderable(renderer, {
        id: `cell-${i}`,
        width: w,
        height: h,
        flexShrink: 0,
        marginRight: i % cols === cols - 1 || i === images.length - 1 ? 0 : GAP,
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

  highlight()
}

renderer.on("resize", () => {
  computeCols()
  selected = Math.min(selected, images.length - 1)
  rebuildGrid()
})

renderer.keyInput.on("keypress", (key) => {
  const move = (dx: number, dy: number) => {
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
    highlight()
  }

  switch (key.name) {
    case "left":
    case "h":
      move(-1, 0)
      break
    case "right":
    case "l":
      move(1, 0)
      break
    case "up":
    case "k":
      move(0, -1)
      break
    case "down":
    case "j":
      move(0, 1)
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
