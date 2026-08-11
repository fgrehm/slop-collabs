#!/usr/bin/env bun

import {
  BoxRenderable,
  ConsolePosition,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core"

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
    content: "phototui",
  }),
)

root.add(
  new TextRenderable(renderer, {
    id: "hint",
    content: "grid coming soon. press Ctrl+C to quit.",
  }),
)

renderer.start()

process.once("SIGINT", () => {
  renderer.destroy()
  process.exit(0)
})
