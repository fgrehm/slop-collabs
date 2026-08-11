# phototui

> [!WARNING]
> A POC for exploring the possibilities. Rough edges expected.

A terminal album viewer/manager/organizer built on [OpenTUI](https://opentui.com) (the Zig-core TUI library that powers OpenCode), modeled on [kommander/xtui](https://github.com/kommander/xtui). The goal is to answer: can a terminal actually be a pleasant place to browse a photo album?

For now: yes, via native terminal image rendering (Kitty graphics, Sixel, or Unicode block fallback, auto-detected). The long game is browsing, organizing, and managing albums from the terminal.

## Status

Early spike. Phase 1 (bootstrap skeleton) is in place. Phase 2 (photo fetch) and Phase 3 (image rendering spike) are next. See [TODO](#todo).

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- A terminal with Kitty or Sixel graphics for native images; others fall back to block rendering

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

## Layout / decisions

See [decisions.md](./decisions.md) for architecture notes and what we learn as we go.

## TODO

- [ ] Phase 2: photo fetch script pulling Unsplash images into `./cache/`
- [ ] Phase 3: spike - render a single image in the terminal, validate premise
- [ ] Phase 4: responsive terminal grid (column count from width, aspect-aware cells)
- [ ] Phase 5: keyboard selection with highlight
- [ ] Phase 5: open a selected image full-screen, navigate between images
- [ ] Stretch: video playback in the terminal

## License

[MIT](https://opensource.org/licenses/MIT).
