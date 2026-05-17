# clickwall — decisions & state

A Hugo shortcode that gates AI-generated content behind a click-to-reveal panel. Built in a single Claude Code session for the `/dev/random` section of fabiorehm.com, where I publish AI-collaborated "TokenLedger" posts.

## Goal

Keep AI-generated content public and indexable, but make the act of reading it a conscious opt-in. The human-written preamble stays unblurred; the AI portion is gated.

## Decisions

| Question | Decision |
|---|---|
| Scope | Posts with `ai_assisted: true` in front matter. Author marks the AI portion explicitly via shortcode (not auto-detected). |
| Gate style | Blur the AI content + modal-style panel overlaid on top. Not a full-page modal — only the AI section, since I write a human preamble. |
| Persistence | Per-post in `localStorage`, single key `clickwall:accepted` = JSON array of paths. Capped at 50, FIFO. Acceptance is not site-wide. |
| Return-visit UX | Smaller "you've seen this before" panel. Content stays blurred until hover/tap, then reveals for the rest of the page view. No re-blur on mouse-out. |
| Markdown rendering inside the shortcode | `.Page.RenderString (dict "display" "block") .Inner` — block mode so headings/paragraphs render. |
| Blur edge bleed | Solved by giving the content its own opaque background that matches a "card" treatment (bg + border + padding + rounded corners). Blur averages against opaque pixels, no dim halo. |
| Mobile | `touchstart` fallback alongside `mouseenter` for the return-visit reveal. |
| Accessibility | `aria-hidden` flipped on reveal. Button is a real `<button>`. Hover-only would fail, so the first visit has an explicit click. |

## Iteration notes

The path to the final design went through a bunch of half-baked alternatives, captured here because the "why we don't have X" is more useful than the "why we have Y":

- **Inline pre-paint script to avoid the flicker on accepted posts.** Worked, but added ~15 lines of inline JS per shortcode use. Dropped in favor of an intentional ~700ms gate-fade animation on accepted posts — then dropped *that* too in favor of "blur stays until hover."
- **CSS `:hover` to reveal.** Worked, but re-blurred on mouse-out, which made reading impossible. Replaced with a one-shot JS `mouseenter` listener that adds the revealed class permanently.
- **`backdrop-filter` on the gate overlay.** Sharper edges than `filter: blur` on the content, but the blur was visually weaker and the overall effect felt less "gated." Reverted.
- **Negative-margin trick** (`padding: 20px; margin: -20px;`) to clip the blur halo via `overflow: hidden`. Worked, but felt hacky and the dim-edge problem returned at the corners. Replaced with: give the content a solid bg matching the theme. Blur averages against opaque pixels, no halo.
- **A small inline "you've seen this" hint** above the blurred content. Looked out of place. Promoted to a proper modal-style panel matching the first-visit gate's look.

## Architecture

```
Hugo paired shortcode (clickwall.html)
  │ renders .Inner via .Page.RenderString in block mode
  │ emits <div class="clickwall" data-clickwall-key="/path/to/post/">
  │   ├─ gate panel (first-visit: title + body + accept button)
  │   ├─ gate-hint panel (return-visit: title + body, no button)
  │   └─ content (the rendered AI markdown, blurred via CSS)
  │
  ▼
JS (clickwall.js, ~70 lines)
  │ on DOMContentLoaded, reads localStorage["clickwall:accepted"]
  │   if path in list:
  │     add .clickwall-accepted class → shows hint panel, hides main gate
  │     attach one-shot mouseenter/touchstart → reveal on first interaction
  │   else:
  │     attach click handler to accept button → mark accepted + reveal
  │
  ▼
CSS (clickwall.css)
  │ .clickwall-content: blur(8px), opaque bg, border, padding
  │ .clickwall-revealed: removes blur
  │ .clickwall-accepted: swaps which gate panel is visible
  │ dark mode via both .colorscheme-dark and prefers-color-scheme
```

## Open questions

- Should I also gate the AI disclaimer partial that renders at the top of every `ai_assisted: true` post? Right now it's always visible, which is probably fine since it's *about* the AI content rather than *being* it.
- Mobile hover detection still feels fragile. A more deliberate "tap to reveal" affordance might be clearer than the current "hover OR touchstart" combo.
- The 50-entry FIFO cap is arbitrary. If I ever publish more than 50 AI posts, oldest acceptances start getting evicted. Probably never a real problem.
