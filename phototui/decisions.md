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

OpenTUI uses a flexbox-style layout. The photo grid is a masonry layout: `cols = width / 16`, each column is a vertical `BoxRenderable` stack, and every image goes into the currently shortest column so the wall stays balanced. Each cell's height is derived from the image's pixel aspect (`imageInfo`) and the terminal's cell aspect ratio (`renderer.resolution`), so portrait and landscape photos keep their shape instead of being cover-cropped into uniform cells.

`cellAspectRatio` is `cellHeight / cellWidth` in pixels (OpenTUI defaults to 2 when the terminal reports no pixel geometry); height-in-rows for width `w` is `round(w * (imgH / imgW) / cellAspectRatio)`.

## Open questions

- Does the block fallback look acceptable on a non-Kitty/Sixel terminal? (Phase 3: yes, it draws per-cell colored half-blocks; looks good enough to build on)
- Video: OpenTUI can render animated images via `NativeImage.decode`, but a true video codec is a much bigger lift. Probably out of scope for this POC.
