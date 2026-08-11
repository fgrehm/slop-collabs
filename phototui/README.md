# phototui

> [!WARNING]
> A POC for exploring the possibilities. Rough edges expected.

A terminal album viewer/manager/organizer built on [OpenTUI](https://opentui.com) (the Zig-core TUI library that powers OpenCode), modeled on [kommander/xtui](https://github.com/kommander/xtui). The goal is to answer: can a terminal actually be a pleasant place to browse a photo album?

For now: yes, via native terminal image rendering (Kitty graphics, Sixel, or Unicode block fallback, auto-detected). The long game is browsing, organizing, and managing albums from the terminal.

## Status

Working POC. Uniform responsive grid with keyboard selection, full-screen viewer, and a performance stack tuned for real albums: virtualized grid, worker-pool decoding, disk thumbnail cache, and terminal-height-scaled prefetch. See [TODO](#todo).

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- A terminal with Kitty or Sixel graphics for native images; others fall back to block rendering

> [!CAUTION]
> phototui won't render native images inside Zellij yet: released Zellij builds only forward Sixel, which Ghostty and several other terminals don't support. The app bails with a clear message rather than show nothing. Run it in a plain terminal tab (Ghostty handles Kitty graphics natively), or use a Zellij build with the [2026-07-31 kitty-graphics support](https://github.com/zellij-org/zellij/pull/5428) once it's released.

## Install / run

```sh
bun install
bun run fetch   # download the sample Unsplash photos into ./cache (gitignored)
bun run start   # launch the TUI against the sample cache
```

Point it at your own photos:

```sh
bun src/index.ts ~/Pictures      # walk a directory recursively
bun src/index.ts .               # the current directory
```

Stress-test the virtualized grid with a large synthetic set:

```sh
bun run scale --count 2000       # duplicate the cached photos to ~2000
bun run start                    # then watch the `d` overlay while scrolling
```

## How it works

- `src/index.ts` boots the OpenTUI renderer and draws the UI.
- `scripts/fetch.ts` downloads a hardcoded list of Unsplash image URLs into `./cache/` so nothing is committed to source control. The viewer reads images from disk.
- Images render through OpenTUI's `ImageRenderable`, which negotiates the best image protocol the terminal supports.
- The grid is **virtualized**: only cells in the visible window (plus a prefetch buffer) are kept alive, and decoded images are freed when their cell scrolls away, so a large gallery stays bounded in memory.
- The prefetch buffer **scales with terminal height** (a full page below the fold, half a page above), so scrolling down never waits on a decode.
- Images are **decoded in a worker pool** off the render thread and **downscaled to the cell's pixel size** before upload, so the terminal receives far fewer bytes per frame (the stdout write is the real frame-time cost).
- A **disk thumbnail cache** (`/tmp/phototui-thumbs`, POC location) decodes each full-resolution photo once into a 256px thumbnail; later visits read the tiny file instead of the original. An in-memory LRU of downscaled pixels makes scroll-back instant.
- Cells show a **spinner** while their decode is pending (visible on first pass through a real album).
- Keys: arrows/hjkl move, enter/o/space opens a photo, escape/q returns or quits, `d` toggles the OpenTUI debug overlay (FPS + memory), `f` toggles per-frame logging to stderr (measure with `bun src/index.ts 2>frames.log`), `b` dumps a one-shot render-stats breakdown (render vs stdout-write time) to stderr.

## Layout / decisions

See [decisions.md](./decisions.md) for architecture notes and what we learn as we go.

## TODO

- [ ] Keyboard scrolling: page up/down, `g`/`G`, `Ctrl-d`/`Ctrl-u` (only the mouse wheel scrolls the grid today)
- [ ] Viewer polish: zoom/pan, image dimensions in the header, fit-vs-fill toggle
- [ ] `bun run thumbs <dir>` script to pre-generate thumbnails so the first session is instant
- [ ] Thumbnail cache productionization: move from `/tmp` to XDG_CACHE_HOME, invalidate on source change, handle deleted files
- [ ] Remove the Zellij startup guard once a Zellij release ships Kitty-graphics support ([PR #5428](https://github.com/zellij-org/zellij/pull/5428))
- [ ] Stretch: video playback in the terminal

## License

[MIT](https://opensource.org/licenses/MIT).
