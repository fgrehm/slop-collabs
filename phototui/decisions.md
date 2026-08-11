# phototui decisions

Working notes captured as we build the POC. Written for a future self (or agent) returning to this code with no context.

## Why OpenTUI + Bun

The whole premise only works if the terminal can render photos. OpenTUI ships a native `ImageRenderable` that auto-selects the best protocol the terminal supports (Kitty graphics -> Sixel -> Unicode block fallback). That fallback means the thing works on almost any terminal, and looks great on a modern one.

Reference: [kommander/xtui](https://github.com/kommander/xtui) is a working OpenTUI app with real image rendering, keybinding, and layout. We copy its shape.

OpenTUI version pinned to `0.5.1` (same as xtui).

## Image source strategy

"Grab a bunch of Unsplash photos" is done with hardcoded `images.unsplash.com` URLs (no API key), downloaded to a local `./cache/` directory that is gitignored. The viewer reads from disk only.

Rationale: keeps the MVP zero-setup, and keeps binaries/images out of the repo. Swapping in a local photo folder or a real Unsplash API client later is trivial because the viewer only ever sees a directory of image files.

## Terminal / multiplexer reality

OpenTUI's `ImageRenderable` auto-detects the protocol. Inside Zellij (released builds) it only forwards Sixel; Ghostty only does Kitty graphics. The protocols don't overlap, so native images silently disappear inside Zellij + Ghostty. We detect Zellij via its env vars (`ZELLIJ` / `ZELLIJ_SESSION_NAME` / `ZELLIJ_PANE_ID`) and bail with a clear message rather than show nothing or an ugly block fallback. Kitty-graphics support landed in Zellij on 2026-07-31 (PR #5428) but is unreleased; once it ships, the guard can go.

## Layout model

OpenTUI uses a flexbox-style layout. The grid is a uniform grid: `cols = width / 16`, every cell the same shape. Images are `cover`-cropped to fill their cell, so portrait and landscape photos present at a consistent size. The full-screen viewer uses `fit: "fit"` to letterbox instead, so the whole photo is visible there.

Cells are square in **pixels** (`CELL_ASPECT = 1`). The cell height in terminal rows is `round(baseCellWidth / (CELL_ASPECT * cellAspectRatio))` where `cellAspectRatio = (res.height/terminalHeight) / (res.width/terminalWidth)` from `renderer.resolution`. You must divide by `cellAspectRatio` because terminal cells are taller than wide (~2:1): a "3:2 in cells" cell is actually portrait in pixels and crops landscape photos wrong. We tried 3:2 (favored landscape), portrait, and masonry; square is the even-handed choice.

Leftover columns (from flooring the cell width) are spread across the first cells of each row so rows fill the full terminal width edge-to-edge.

## Virtualization and memory

Only image **metadata** is held in memory; renderables are created on demand for the visible window and destroyed when they scroll away. This is required for a large gallery, because `ImageRenderable` decodes its source eagerly on `set source` (`NativeImage.load`) and keeps the decoded image until the renderable is destroyed.

Key points:

- `ImageRenderable.destroySelf()` aborts the in-flight load and calls `NativeImage.dispose()`, so destroying a cell frees its decoded image memory. This is the primitive the virtualizer relies on.
- `viewportCulling: true` on the `ScrollBoxRenderable` only skips layout/measure for off-screen children; it does **not** free decoded images. So it is not a substitute for virtualization.
- The content box is given an explicit `height = totalHeight` (all rows) so the scrollbar range is correct even though only a sparse set of cells is alive. Cells are `position: "absolute"` with `top`/`left` so adding/removing them does not reflow the list.
- A `Map<index, BoxRenderable>` holds live cells. Each frame, if `scrollTop` or terminal size changed, we reconcile: destroy cells outside `[first, last]` (visible range plus a `BUFFER_ROWS` margin), create cells inside it that are missing.
- `renderer.on("frame", ...)` is the hook; OpenTUI has no scroll event. The reconcile early-returns when nothing changed.

Measured at startup with 46 photos, an 80-col terminal: 20 cells alive (5 cols, cellH 8, totalHeight 89). Scroll keeps the live count bounded to roughly viewport + 2*buffer.

## Performance: where the time actually goes

Measured with `renderer.getStats()` (`gatherStats: true` in the renderer config) in a real Ghostty terminal, bound to `b`:

- **The bottleneck is the stdout write, not decode and not the render pass.** `nativeRenderTime` is ~0ms; `nativeStdoutWriteTime` is the whole frame (~33ms at 30fps). `cellsUpdated` spikes to 1000-2600 whenever the visible window changes (scroll/selection/resize). The frame budget is 33ms, so stdout at ~33ms pins you at 30fps and drops below 20 under image-heavy load.
- **`cellsUpdated` spikes come from newly-visible cells being fully drawn** (scrolling creates new cells that must be painted), not from selection moves: the Box `border`/`borderColor` setters bail early when the value is unchanged, so moving selection only dirties the two cells whose border actually changed.
- **Decode off the main thread keeps the loop responsive but does not fix the stdout cost.** The render pass and the stdout write are still on the main thread and cannot be moved.
- **The fix: downscale thumbnails to the cell's pixel size in the worker.** The worker calls `NativeImage.resize` to cover the cell's pixel dims (computed from `renderer.resolution`), so `fromRgba` uploads a tiny image and the terminal receives far fewer bytes per cell. Measured: 50 images full-res = ~75MiB of RGBA vs 242KiB downscaled to 30x30 (~300x fewer bytes).

## Decoding off the main thread (worker pool)

OpenTUI's `imageDecode` is a synchronous native (Zig) FFI that blocks the main thread; `NativeImage.load` only awaits the file read, not the decode. We offload decoding to a pool of `node:worker_threads` workers:

- Each worker reads the file, decodes to RGBA, optionally downscales, and transfers the buffer back zero-copy (transfer list).
- The main thread builds a `NativeImage` via `fromRgba` and injects it into the renderable's private `_image` field (bypassing `set source`, which would re-decode on the main thread), then calls `requestRender()`.
- In-flight decodes are cancelled when their cell scrolls away before the result returns.
- A Bun worker can load `@opentui/core`; each worker gets its own instance of the native lib (verified).
- Pool sized `min(8, max(2, availableParallelism()))`.
- **Honest tradeoff:** for small images the pool is slower in wall-clock than main-thread decode (worker message overhead), but the win is responsiveness: the main/render thread never blocks. Verified the frame loop holds a steady ~33ms during decoding with a 2046-image gallery.

## Gotchas learned

- OpenTUI names the Enter key `return` (keypad `kpenter`), not `enter`. A handler matching `key.name === "enter"` never fires; only `o` worked until we fixed it.
- `console.log`/`console.error` are captured by OpenTUI's console overlay, not written to stderr, unless `OTUI_USE_CONSOLE=false`. For diagnostics that must reach a file/pipe, use `process.stderr.write` directly (and set `OTUI_USE_CONSOLE=false` when running headless tests), or toggle the overlay with `renderer.console.show()`.
- The built-in debug overlay (`renderer.toggleDebugOverlay()`, bound to `d`) shows live FPS + memory; `f` toggles per-frame `dt` logging to stderr for measuring outside the overlay (`bun src/index.ts 2>frames.log`); `b` dumps a one-shot render-stats breakdown (render vs stdout-write time, cellsUpdated) to stderr.
- `renderer.getStats()` returns real numbers only when `gatherStats: true` is set in the renderer config.
- Cross-file `.ts` imports under Bun + `moduleResolution: NodeNext` need `allowImportingTsExtensions: true` in tsconfig.

## Open questions

- Does the block fallback look acceptable on a non-Kitty/Sixel terminal? (Phase 3: yes, it draws per-cell colored half-blocks; looks good enough to build on)
- Video: OpenTUI can render animated images via `NativeImage.decode`, but a true video codec is a much bigger lift. Probably out of scope for this POC.