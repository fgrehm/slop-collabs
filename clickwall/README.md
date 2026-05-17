# clickwall

> *WARNING: This was done in a single 30m Claude Code session with Opus 4.7 on 2026-05-17 on top of [fabiorehm.com](https://github.com/fgrehm/fabiorehm.com). More info on [decisions.md](./decisions.md).*

A tiny Hugo paired shortcode that gates AI-generated sections of a blog post behind a "click to reveal" panel, TOS-style. After a reader accepts once, subsequent visits to the same post show a softer "you've seen this before" panel that unblurs on hover (or tap).

The blog post itself stays public and indexable; the shortcode is just a UI affordance to make the AI-generated portions a conscious choice, separate from the human-written preamble.

## What it looks like

**First visit:** the AI portion of the post renders as a blurred card with an overlay panel:

> *AI-generated content ahead. Everything below this point was written by an AI model (with my steering and editing). It may be confidently wrong. Treat it as a thinking trail, not expert advice.*
> *[Show me the AI content]*

**Return visit (after accepting):** smaller panel, no button, reveals on hover:

> *You've seen this before. Still AI-generated. Hover (or tap) to reveal.*

**Revealed:** card stays in place with its own bg + border so the AI section is visually demarcated from the human writing around it.

## Files

| File | Purpose |
|---|---|
| `clickwall.shortcode.html` | Hugo paired shortcode — drop in `layouts/shortcodes/clickwall.html` |
| `clickwall.js` | Vanilla JS, ~70 lines, no deps. Wire via `customJS` or your own asset pipeline. |
| `clickwall.css` | The styles. Append to your existing CSS. |

## Usage

In a markdown post, wrap the AI portion:

```markdown
My human-written preamble here. Context, why I'm publishing this, etc.

{{< clickwall >}}

## The AI-generated content

...headings, links, code blocks, even other shortcodes work...

{{< /clickwall >}}
```

The shortcode renders `.Inner` through `.Page.RenderString` in block mode, so markdown inside behaves normally.

## How it works

- **Persistence:** single `clickwall:accepted` key in `localStorage`, a JSON array of accepted post paths (`.Page.RelPermalink`). Capped at 50 entries, FIFO eviction — won't grow unbounded.
- **First-visit gate:** full panel + accept button. Click adds the path to the array and reveals.
- **Return-visit gate:** smaller "you've seen this" panel, no persistence write. First `mouseenter` or `touchstart` reveals for the rest of the page view.
- **No re-blur on mouse-out** once revealed.
- **Theme support:** light + dark, both via `.colorscheme-dark` class (manual toggle) and `prefers-color-scheme: dark` (auto). Tuned for the [Hugo Coder](https://github.com/luizdepra/hugo-coder) theme but easily portable.

## Caveats

- Not a paywall, not access control. The HTML is fully present in the page source. This is a UI consent affordance, not a privacy boundary.
- `:hover` on touch devices is finicky; the JS adds a `touchstart` listener as a fallback for the return-visit case.
- The blur uses `filter: blur(8px)`. The card has its own opaque background so the blur halo doesn't bleed weirdly at the edges (an issue you'll hit if you blur over a transparent background).

## License

[MIT](../LICENSE).
