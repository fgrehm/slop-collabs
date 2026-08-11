# phototui

> [!WARNING]
> A POC for exploring the possibilities. Rough edges expected.

A terminal album viewer/manager/organizer built on [OpenTUI](https://opentui.com) (the Zig-core TUI library that powers OpenCode), modeled on [kommander/xtui](https://github.com/kommander/xtui). The goal is to answer: can a terminal actually be a pleasant place to browse a photo album?

For now: yes, via native terminal image rendering (Kitty graphics, Sixel, or Unicode block fallback, auto-detected). The long game is browsing, organizing, and managing albums from the terminal.

## Status

Early spike. Bootstrap, photo fetch, a uniform responsive grid with keyboard selection, and a full-screen viewer are all in. See [TODO](#todo).

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- A terminal with Kitty or Sixel graphics for native images; others fall back to block rendering

> [!CAUTION]
> phototui won't render native images inside Zellij yet: released Zellij builds only forward Sixel, which Ghostty and several other terminals don't support. The app bails with a clear message rather than show nothing. Run it in a plain terminal tab (Ghostty handles Kitty graphics natively), or use a Zellij build with the [2026-07-31 kitty-graphics support](https://github.com/zellij-org/zellij/pull/5428) once it's released.

## Install / run

```sh
bun install
bun run fetch   # download the sample Unsplash photos into ./cache (gitignored)
bun run start   # launch the TUI
```

## How it works

- `src/index.ts` boots the OpenTUI renderer and draws the UI.
- `scripts/fetch.ts` downloads a hardcoded list of Unsplash image URLs into `./cache/` so nothing is committed to source control. The viewer reads images from disk.
- Images render through OpenTUI's `ImageRenderable`, which negotiates the best image protocol the terminal supports.
- The grid is **virtualized**: only cells in the visible window (plus a small buffer) are kept alive, and decoded images are freed when their cell scrolls away, so a large gallery stays bounded in memory.
- Keys: arrows/hjkl move, enter/o/space opens a photo, escape/q returns or quits, `d` toggles the OpenTUI debug overlay (FPS + memory), `f` toggles per-frame logging to stderr (measure with `bun src/index.ts 2>frames.log`).

## Layout / decisions

See [decisions.md](./decisions.md) for architecture notes and what we learn as we go.

## TODO

- [x] Phase 2: photo fetch script pulling Unsplash images into `./cache/`
- [x] Phase 3: spike - render a single image in the terminal, validate premise
- [x] Phase 4: responsive terminal grid (column count from width, aspect-aware cells)
- [x] Phase 5: keyboard selection with highlight
- [x] Phase 5: open a selected image full-screen, navigate between images
- [ ] Stretch: video playback in the terminal

## License

[MIT](https://opensource.org/licenses/MIT).
