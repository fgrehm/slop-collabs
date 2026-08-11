# phototui decisions

Working notes captured as we build the POC. Written for a future self (or agent) returning to this code with no context.

## Why OpenTUI + Bun

The whole premise only works if the terminal can render photos. OpenTUI ships a native `ImageRenderable` that auto-selects the best protocol the terminal supports (Kitty graphics -> Sixel -> Unicode block fallback). That fallback means the thing works on almost any terminal, and looks great on a modern one.

Reference: [kommander/xtui](https://github.com/kommander/xtui) is a working OpenTUI app with real image rendering, keybinding, and layout. We copy its shape.

OpenTUI version pinned to `0.5.1` (same as xtui).

## Image source strategy

"Grab a bunch of Unsplash photos" is done with hardcoded `images.unsplash.com` URLs (no API key), downloaded to a local `./cache/` directory that is gitignored. The viewer reads from disk only.

Rationale: keeps the MVP zero-setup, and keeps binaries/images out of the repo. Swapping in a local photo folder or a real Unsplash API client later is trivial because the viewer only ever sees a directory of image files.

## Layout model

OpenTUI uses a flexbox-style layout. A grid is built from a `BoxRenderable` with `flexDirection: "row"` / `"column"` and gap. Cell height can be derived from `ImageRenderable.cellAspectRatio` (xtui does this to keep a 16:9 video card tall enough). We'll lean on the same trick for aspect-aware cells.

## Open questions

- Does the block fallback look acceptable on a non-Kitty/Sixel terminal? (Phase 3: yes, it draws per-cell colored half-blocks; looks good enough to build on)
- Video: OpenTUI can render animated images via `NativeImage.decode`, but a true video codec is a much bigger lift. Probably out of scope for this POC.
