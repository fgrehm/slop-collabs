# Obsidian callout showcase

This page demonstrates Obsidian's built-in callout types. The shortcode appears in backticks next to each rendered callout.

## Custom types

> [!bigquote] Big quote (`bigquote`)
> Make it work, then make it clear.

> [!reading-list] Reading list (`reading-list`)
> Books, articles, papers, and other things to read.

> [!journaling] Journaling notes (`journaling`)
> A space for personal reflection and daily notes.

## Built-in callouts

> [!note] Note (`note`)
> General information.

> [!abstract] Abstract (`abstract`)
> A summary or overview.

> [!info] Info (`info`)
> Additional context.

> [!todo] Todo (`todo`)
> Something that needs to be done.

> [!tip] Tip (`tip`)
> A useful suggestion.

> [!success] Success (`success`)
> A successful result.

> [!question] Question (`question`)
> A question or open issue.

> [!warning] Warning (`warning`)
> Something that deserves attention.

> [!failure] Failure (`failure`)
> An unsuccessful result.

> [!danger] Danger (`danger`)
> A serious warning.

> [!bug] Bug (`bug`)
> A reproducible problem.

> [!example] Example (`example`)
> A worked example.

> [!quote] Quote (`quote`)
> Quoted text or a citation.

## Aliases

Aliases use the same styling as their canonical callout type:

- `summary` and `tldr` -> `abstract`
- `hint` and `important` -> `tip`
- `check` and `done` -> `success`
- `help` and `faq` -> `question`
- `caution` and `attention` -> `warning`
- `fail` and `missing` -> `failure`
- `error` -> `danger`
- `cite` -> `quote`

> [!faq] FAQ (`faq` -> `question`)
> This uses the `question` alias.

## Folding

> [!tip]+ Expanded by default (`tip`)
> This callout starts open.

> [!warning]- Collapsed by default (`warning`)
> This callout starts closed.

## Custom title

> [!info] A custom title (`info`)
> The shortcode stays `info`; the title is independent.

## Nested callouts

> [!note] Outer callout (`note`)
> Outer content.
>
> > [!tip] Nested callout (`tip`)
> > Nested content.

> [!project] Custom type (`project`)
> Unsupported types can be given their own styling with CSS. Without custom CSS, Obsidian falls back to note-like styling.
