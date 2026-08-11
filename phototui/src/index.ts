#!/usr/bin/env bun

import {
  BoxRenderable,
  ConsolePosition,
  ImageRenderable,
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

// Find the first cached image so the spike works no matter which files exist.
const imageFile = readdirSync(CACHE_DIR)
  .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
  .sort()[0]

if (!imageFile) {
  console.error("no images in ./cache - run `bun run fetch` first")
  process.exit(1)
}

const source = resolve(CACHE_DIR, imageFile)

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  consoleOptions: { position: ConsolePosition.BOTTOM },
})

const root = new BoxRenderable(renderer, {
  id: "root",
  width: "100%",
  height: "100%",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  gap: 1,
})
renderer.root.add(root)

root.add(
  new TextRenderable(renderer, {
    id: "title",
    content: imageFile,
    selectable: false,
  }),
)

const image = new ImageRenderable(renderer, {
  id: "spike-image",
  source,
  width: 60,
  height: 20,
  fit: "fit",
  protocol: "auto",
  onError: (err) => console.error("image load failed:", err),
})
root.add(image)

await image.loadPromise

renderer.start()

process.once("SIGINT", () => {
  renderer.destroy()
  process.exit(0)
})
