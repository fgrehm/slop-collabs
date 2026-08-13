# gh-recap

> [!WARNING]
> Prototype. Revised from the original `gh-standup` (one-repo team standup) to its current personal-refresher shape; tested against fixtures, not yet run live against `gh`. See [decisions.md](./decisions.md).

A small bash CLI that emits an LLM-ready prompt summarizing what **you** did across one or more GitHub repos over a time window, with **others'** activity as compact context. Pipe the output to any LLM for a daily refresher.

```bash
gh-recap org/web org/api org/infra | <your-llm-call-here>
```

The tool only **builds the prompt**. It never calls an LLM itself; that's your choice. Use `pi`, `claude`, `pbcopy`, or anything that reads stdin.

## What it does

For each repo you name, over the time window you give it, fetches:

- PRs (opened, merged, closed-unmerged, or open with reviews/comments in window)
- Issues (opened, closed, or open with comments in window)
- Reviews and comments nested inside those PRs and issues

Then emits a structured markdown prompt with:

- Prompt instructions for the LLM
- **What you did** — PRs and issues authored by you, with bodies and review state
- **What others did** — PRs and issues authored by others (humans), one line each
- **Automated activity (raw)** — bot PRs/issues, listed raw, with instructions for the LLM to aggregate rather than enumerate

Your GitHub handle is auto-detected via `gh api user`. Pass `--me` to override.

Commits aren't included; the design assumes everything ships through PRs.

## Requirements

- [`gh`](https://cli.github.com/) - authenticated (`gh auth login`)
- [`jq`](https://jqlang.github.io/jq/) - 1.6+
- `sha256sum` (Linux) or `shasum` (macOS) for cache keys

Date math uses jq's `now`/`todateiso8601`, so there is no `date`/`gdate` dependency.

## Install

```bash
curl -o /usr/local/bin/gh-recap https://path/to/gh-recap
chmod +x /usr/local/bin/gh-recap
```

Or drop it anywhere on `$PATH`.

## Usage

```
gh-recap <owner/repo>... [--me <handle>] [--last-day|--last-week|--since <ISO8601>]
        [--no-cache] [--cache-dir DIR]
```

| Flag | Meaning |
|---|---|
| `<owner/repo>...` | One or more repos, e.g. `org/web org/api` |
| `--me` | Your GitHub handle. Auto-detected from `gh api user` if omitted |
| `--last-day` | Cover since the start of yesterday UTC to now (default) |
| `--last-week` | Cover since the start of 7 days ago UTC to now |
| `--since` | Cover explicit ISO 8601 UTC timestamp, e.g. `2026-05-14T00:00:00Z` |
| `--no-cache` | Skip cache, always hit GitHub API, do not write cache |
| `--cache-dir` | Override cache location (default `~/.cache/gh-recap`) |

### Examples

```bash
# Yesterday across three repos (auto-detects your handle)
gh-recap org/web org/api org/infra | llm

# Last week
gh-recap org/repo --last-week | claude

# Explicit window and handle
gh-recap org/repo --me alice --since 2026-05-14T00:00:00Z | claude

# Force fresh fetch (also suppresses cache writes)
gh-recap org/repo --no-cache | llm

# Inspect the prompt without piping anywhere
gh-recap org/repo | less
```

## Caching

Responses are cached per repo at `~/.cache/gh-recap/<owner>__<name>__<hash>.json`, key = first 16 chars of `sha256(repo + since)`. Your handle is cached at `~/.cache/gh-recap/.me`.

- Re-running with the same args is instant (no API call)
- Iterating on the prompt template (editing the script) does not re-fetch
- Force refresh with `--no-cache` or by `rm`-ing the cache file
- `--no-cache` skips both cache reads and cache writes

The cache stores the **raw GraphQL response**, not the rendered prompt; prompt changes always re-render from cached data. Cache files are written atomically (temp + `mv`) so interrupted runs do not leave corrupt files.

## Output shape

A markdown-ish prompt:

```markdown
**You are writing a personal recap for @alice, covering the window
2026-05-14T00:00:00Z -> now across the repos listed below.**

[instructions: your section deep, others compact, bots aggregated]

---

## What you did

### org/web

##### Merged in window

- [#101] Fix race condition in worker pool - +42/-8 across 3 files
  URL: https://github.com/org/web/pull/101
  Reviews: 1 approved
  Body:
    Summary
    We had a race in the worker pool, see worker.go:42.
    ...

##### Opened in window
...

### org/api
...

## What others did

### org/web

##### Opened in window

- [#55] Bug in login - @carol
  URL: https://github.com/org/web/issues/55
...

## Automated activity (raw)

### org/web

##### Opened in window

- [#102] Bump lodash - @dependabot[bot]
  URL: https://github.com/org/web/pull/102
...
```

Empty sections and empty per-repo subsections are suppressed, so a quiet repo or a window with no bot activity does not leak bare headers.

## Design notes

- **Personal, not team.** The original tool emitted a team standup narrative for one repo. `gh-recap` splits activity into three classes by author: you, other humans, bots. Yours gets full detail (titles, diff sizes, review state, bodies); others get one line each; bots stay raw and are aggregated by the LLM.
- **Single-shot, not map-reduce.** The tool emits one prompt per run, no per-PR LLM calls. This keeps it LLM-agnostic (`gh-recap | <anything>`), avoids API key management, and lets the cache do useful work. For repos with 50+ PRs/day this may saturate context; switch to a multi-stage tool then.
- **Date math is internal and snapped to UTC day boundaries.** `--last-day` and `--last-week` are computed from jq's `now` and `todateiso8601`, then snapped to the start of a UTC day. Two benefits: (a) cache key = `sha256(repo + since)` is stable across runs in the same calendar day, so the cache actually hits; (b) "last day" means "since the start of yesterday", not a rolling 24h window. No `date`/`gdate` dependency. `--since` is the escape hatch and must be UTC `Z` form because window comparisons are string comparisons against the API's `Z`-suffixed timestamps.
- **Bot detection** uses `author.__typename == "Bot"` (primary) with `[bot]` suffix fallback. Bots aren't filtered out; they're segregated.
- **Markdown stripping** uses jq `gsub` with named captures. Handles code fences, inline code, images, links, headings, emphasis, blockquotes, `<details>` blocks. Not a full CommonMark parser; just enough to make bodies LLM-friendly.
- **Body truncation:** bodies > 2000 chars (post-strip) get truncated to first paragraph + first bullet group. Tune in the script if your team writes essays.
- **Window filtering:** GraphQL's `pullRequests`/`issues` connections don't accept a `since` parameter. We over-fetch the 50 most-recently-updated and filter in jq. Nested `comments` are fetched with `orderBy: UPDATED_AT DESC` so the most-recent ones (the ones likely inside the window) are always in the first 20 returned. The `reviews` connection does not accept `orderBy` at all, so reviews are fetched in the API's default order; for long-lived PRs with many reviews this can drop recent reviews from the `first: 20` window. For very high-velocity repos, add cursor pagination.

## Limitations

- **No pagination yet.** Capped at 50 most-recently-updated PRs and 50 issues per repo, and 20 reviews/comments per PR/issue. Fine for most daily windows.
- **No commit/PR linking.** PRs only; LLM has to infer from merge commits if needed.
- **`--since` must be UTC `Z` form.** Other timezone offsets are rejected because window comparisons are string-based.
- **No reviews-you-submitted.** "What you did" is PRs and issues you authored. Reviews you left on others' PRs are not surfaced (yet).

## Prior art

Surveyed before the original `gh-standup`. Nothing fits "CLI that emits an LLM prompt for your recent activity across repos":

- [`gh-dash`](https://github.com/dlvhdr/gh-dash) - TUI, no summarization
- [`git-standup`](https://github.com/kamranahmedse/git-standup) - commits only, no LLM
- [`spencerkimball/repo-digest`](https://github.com/spencerkimball/repo-digest) - HTML digest, Go, last meaningful work 2016
- [`tweag/work-daigest`](https://github.com/tweag/work-daigest) - single-user, multi-source, Bedrock-bound
- [`flows-network/github-pr-summary`](https://github.com/flows-network/github-pr-summary) - per-PR summary as PR comment
- [Gitmore](https://gitmore.io/) - SaaS daily digest with Slack delivery (closest product, but hosted)