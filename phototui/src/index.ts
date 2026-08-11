#!/usr/bin/env bun

import {
  BoxRenderable,
  ConsolePosition,
  ImageRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
  imageInfo,
} from "@opentui/core"
import { readFileSync, readdirSync } from "node:fs"
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
  .map((file) => {
    const path = resolve(CACHE_DIR, file)
    const { width, height } = imageInfo(readFileSync(path))
    return { file, source: path, width, height }
  })

if (images.length === 0) {
  console.error("no images in ./cache - run `bun run fetch` first")
  process.exit(1)
}

const GAP = 1
const COL_MIN_WIDTH = 16

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
  consoleOptions: { position: ConsolePosition.BOTTOM },
})

// Cell aspect ratio (cell height / cell width in pixels) so we can convert an
// image's pixel aspect into the right number of terminal rows. Defaults to 2
// (the OpenTUI default) when the terminal doesn't report pixel geometry.
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

// Masonry bookkeeping: which column each image is in, and the images of each
// column in vertical order.
let imageCol: number[] = []
let colImages: number[][] = []
let cellBoxes: BoxRenderable[] = []
let contentBox: BoxRenderable | null = null

function updateHeader() {
  header.content = `phototui - ${images.length} photos - arrows to move, q to quit`
}

function computeCols() {
  const maxCols = Math.max(1, Math.floor(renderer.width / COL_MIN_WIDTH))
  cols = Math.min(maxCols, images.length)
}

function colWidth() {
  return Math.max(1, Math.floor((renderer.width - (cols - 1) * GAP) / cols))
}

// Ideal cell height (in terminal rows) for an image so it keeps its aspect.
function imageHeight(i: number, w: number) {
  const { width, height } = images[i]!
  return Math.max(1, Math.round((w * (height / width)) / cellAspectRatio()))
}

// Vertical offset (in rows) of an image from the top of its column.
function colOffset(i: number) {
  const col = imageCol[i]!
  let y = 0
  for (const other of colImages[col]!) {
    if (other === i) return y
    y += imageHeight(other, colWidth()) + GAP
  }
  return y
}

function highlight() {
  cellBoxes.forEach((cell, i) => {
    cell.border = i === selected
    cell.borderColor = i === selected ? "#f38ba8" : "transparent"
  })
  grid.scrollTo({ x: 0, y: colOffset(selected) })
}

function rebuildGrid() {
  contentBox?.destroyRecursively()
  cellBoxes = []
  imageCol = new Array(images.length)
  colImages = Array.from({ length: cols }, () => [])

  contentBox = new BoxRenderable(renderer, {
    id: "grid-content",
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    flexShrink: 0,
  })
  grid.content.add(contentBox)

  const w = colWidth()
  const car = cellAspectRatio()
  const colHeights: number[] = new Array(cols).fill(0)

  // Assign each image to the shortest column so heights stay balanced.
  const columnBoxes: BoxRenderable[] = []
  for (let c = 0; c < cols; c++) {
    const column = new BoxRenderable(renderer, {
      id: `col-${c}`,
      width: w,
      flexDirection: "column",
      flexShrink: 0,
      marginRight: c === cols - 1 ? 0 : GAP,
    })
    contentBox.add(column)
    columnBoxes.push(column)
  }

  for (let i = 0; i < images.length; i++) {
    const { file, source, width, height } = images[i]!
    const h = Math.max(1, Math.round((w * (height / width)) / car))

    let c = 0
    for (let k = 1; k < cols; k++) if (colHeights[k]! < colHeights[c]!) c = k
    imageCol[i] = c
    colImages[c]!.push(i)
    colHeights[c]! += h + GAP

    const cell = new BoxRenderable(renderer, {
      id: `cell-${i}`,
      width: w,
      height: h,
      flexShrink: 0,
      marginBottom: GAP,
      borderStyle: "rounded",
      border: false,
    })
    columnBoxes[c]!.add(cell)

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

  selected = Math.min(selected, images.length - 1)
  highlight()
}

function nearestInColumn(c: number, fromY: number) {
  const members = colImages[c]!
  if (members.length === 0) return -1
  let best = members[0]!
  let bestDist = Infinity
  for (const m of members) {
    const d = Math.abs(colOffset(m) - fromY)
    if (d < bestDist) {
      bestDist = d
      best = m
    }
  }
  return best
}

function move(dx: number, dy: number) {
  const c = imageCol[selected]!
  if (dx !== 0) {
    const target = (c + dx + cols) % cols
    const next = nearestInColumn(target, colOffset(selected))
    if (next >= 0) selected = next
    return
  }
  const members = colImages[c]!
  const pos = members.indexOf(selected)
  const target = pos + dy
  if (target < 0 || target >= members.length) return
  selected = members[target]!
}

renderer.on("resize", () => {
  computeCols()
  rebuildGrid()
})

renderer.keyInput.on("keypress", (key) => {
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
