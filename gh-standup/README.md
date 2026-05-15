# gh-standup

> *WARNING: This was done over a single 20min claude.ai session with Opus 4.7 on 2026-05-15, more info on [decisions.md](./decisions.md)*

A small bash CLI that emits an LLM-ready prompt summarizing recent GitHub repo activity. Pipe the output to any LLM to get a daily standup.

```bash
gh-standup cli/cli --since "$(date -u -d '1 day ago' +%FT%TZ)" | <your-llm-call-here>
```

The tool only **builds the prompt**. It never calls an LLM itself - that's your choice. Use `pi`, `claude`, `pbcopy`, or anything that reads stdin.

## What it does

For one repo, over the time window you give it, fetches:

- PRs opened, merged, closed-unmerged, or with reviews/comments in window
- Issues opened, closed, or with comments in window
- Reviews and comments nested inside those PRs and issues

Then emits a structured markdown prompt with:

- Standup-writing instructions for the LLM
- Counts up top (sanity check for the LLM and you)
- Human activity grouped by event type
- Bot activity in a separate section (with instructions to aggregate, not enumerate)
- PR/issue bodies stripped of markdown, truncated if very long

Commits aren't included - the design assumes everything ships through PRs.

## Requirements

- [`gh`](https://cli.github.com/) - authenticated (`gh auth login`)
- [`jq`](https://jqlang.github.io/jq/) - 1.6+
- `sha256sum` (Linux) or `shasum` (macOS) for cache keys
- `date` (Linux) or `gdate` (macOS, via `brew install coreutils`) if you want the `1 day ago` syntax in `--since`

## Install

```bash
curl -o /usr/local/bin/gh-standup https://path/to/gh-standup
chmod +x /usr/local/bin/gh-standup
```

Or drop it anywhere on `$PATH`.

## Usage

```
gh-standup <owner/repo> --since <ISO8601> [--no-cache] [--cache-dir DIR]
```

| Flag | Meaning |
|---|---|
| `<owner/repo>` | Required. e.g. `cli/cli` |
| `--since` | Required. ISO 8601 timestamp, e.g. `2026-05-14T00:00:00Z` |
| `--no-cache` | Skip cache, always hit GitHub API |
| `--cache-dir` | Override cache location (default `~/.cache/gh-standup`) |

### Examples

```bash
# Yesterday's activity (Linux)
gh-standup cli/cli --since "$(date -u -d '1 day ago' +%FT%TZ)" | llm

# Yesterday's activity (macOS with coreutils)
gh-standup cli/cli --since "$(gdate -u -d '1 day ago' +%FT%TZ)" | llm

# Specific timestamp
gh-standup myorg/myrepo --since 2026-05-14T00:00:00Z | claude

# Force refresh
gh-standup cli/cli --since 2026-05-14T00:00:00Z --no-cache | llm

# Inspect the prompt without piping anywhere
gh-standup cli/cli --since 2026-05-14T00:00:00Z | less
```

## Caching

Responses are cached by `sha256(repo + since)` at `~/.cache/gh-standup/`. This means:

- Re-running with the same args is instant (no API call)
- Iterating on the prompt template (editing the script) doesn't re-fetch
- To force refresh: `--no-cache` or `rm` the cache file

The cache stores the **raw GraphQL response**, not the rendered prompt - so prompt changes always re-render from cached data.

## Output shape

A markdown-ish prompt that looks like:

```markdown
You are writing a daily team standup summary for the GitHub repository
acme/widget, covering activity since 2026-05-14T00:00:00Z.

[instructions about narrative, bot aggregation, length, link format]

---

## Event log

Repo: acme/widget
Window: 2026-05-14T00:00:00Z → now
Counts: 2 merged, 1 opened, 0 closed-unmerged, 1 PRs touched-still-open; ...

### Human activity

#### Pull requests

##### Merged in window

- [#101] Fix race condition in worker pool - @alice — +42/-8 across 3 files
  URL: https://github.com/acme/widget/pull/101
  Reviews: 1 approved
  Body:
    Summary
    We had a race in the worker pool - see worker.go:42.
    ...

##### Opened in window
...

### Automated activity (raw)
...
```

See [`sample-prompt-output.txt`](./sample-prompt-output.txt) for a full example.

## Design notes

- **Single-shot, not map-reduce.** The tool emits one prompt per run - no per-PR LLM calls. This keeps it LLM-agnostic (`gh-standup | <anything>`), avoids API key management, and lets the cache do useful work. For repos with 50+ PRs/day this may saturate context; switch to a multi-stage tool then.
- **Bot detection** uses `author.__typename == "Bot"` (primary) with `[bot]` suffix fallback. Bots aren't filtered out - they're segregated, and the prompt instructs the LLM to aggregate them ("3 dependabot bumps") rather than enumerate.
- **Markdown stripping** uses jq `gsub` with named captures. Handles code fences, inline code, images, links, headings, emphasis, blockquotes. Not a full CommonMark parser - just enough to make bodies LLM-friendly.
- **Body truncation:** bodies > 2000 chars get truncated to first paragraph + bullets. Tune in the script if your team writes essays.
- **Window filtering:** GraphQL's `pullRequests`/`issues` connections don't accept a `since` parameter. We over-fetch the 50 most-recently-updated and filter in jq. For very high-velocity repos, add cursor pagination.

## Limitations

- **No pagination yet.** Capped at 50 most-recently-updated PRs and 50 issues. Fine for most daily windows.
- **Default branch only** would matter if we fetched commits - we don't, so feature branch PRs appear normally.
- **No commit→PR linking.** LLM has to infer from merge commits. Usually fine.
- **ISO 8601 required for `--since`.** No "1 day ago" parsing built in. Wrap with `date`/`gdate`.

## Prior art

Surveyed before building. Nothing fits "CLI that emits an LLM prompt for one repo's daily activity":

- [`gh-dash`](https://github.com/dlvhdr/gh-dash) - TUI, no summarization
- [`git-standup`](https://github.com/kamranahmedse/git-standup) - commits only, no LLM
- [`spencerkimball/repo-digest`](https://github.com/spencerkimball/repo-digest) - HTML digest, Go, last meaningful work 2016
- [`tweag/work-daigest`](https://github.com/tweag/work-daigest) - single-user, multi-source, Bedrock-bound
- [`flows-network/github-pr-summary`](https://github.com/flows-network/github-pr-summary) - per-PR summary as PR comment
- [Gitmore](https://gitmore.io/) - SaaS daily digest with Slack delivery (closest product, but hosted)
