# gh-recap — decisions & state

A small bash CLI that emits an LLM-ready prompt summarizing **your** recent GitHub activity across one or more repos, with others' activity as compact context. Pipe to any LLM (`gh-recap … | llm`, `| claude`, `| pbcopy`).

## Goal

Daily personal refresher: what **I** did across a set of repos over the last day (or week, or explicit window), plus a compact view of what **others** did over the same window. Output to stdout for piping to any LLM.

## History

The original tool was `gh-standup`, a one-repo team-standup narrative built in a single 20-min claude.ai session on 2026-05-15. It was reviewed, found to have a few correctness risks (see "Review findings folded in" below), and then reshaped to its current personal-refresher form under a new name, `gh-recap`. The prior-art survey at the bottom still reflects the original scope ("one repo's daily activity") and is kept for provenance.

## Decisions

| Question | Decision |
|---|---|
| Use case | Personal refresher, not team standup |
| Scope of "activity" | PRs (opened/merged/closed/reviews/comments) + issues (opened/closed/comments). **No raw commits** — work projects ship through PRs. |
| Repos | One or more positional args. `gh-recap org/web org/api org/infra` produces one combined prompt with per-repo subsections. |
| Whose activity | Split into three classes by author: **you**, **other humans**, **bots**. Yours gets full detail; others get one line; bots stay raw and aggregated. |
| Your handle | Auto-detected via `gh api user --jq .login`, cached at `~/.cache/gh-recap/.me`. Override with `--me <handle>`. |
| "What you did" | PRs and issues **you authored** (lifecycle buckets: merged / opened / closed-unmerged / touched-open). Reviews you submitted on others' PRs are NOT included yet (see open items). |
| "What others did" | Compact: one line per PR/issue authored by non-you humans, no bodies. |
| Bots | Segregated in their own section. Detected via `author.__typename == "Bot"` (primary) + `[bot]` suffix on login (fallback). |
| Output | Stdout. Tool emits prompt only; never calls an LLM. |
| Time window | `--last-day` (default) snaps to start of yesterday UTC, `--last-week` snaps to start of 7 days ago UTC, or `--since <ISO8601>`. Date math via jq `now`/`todateiso8601`, snapped to UTC day boundaries for cache-key stability. No `date`/`gdate` dependency. `--since` must be UTC `Z` form (string-comparison against API timestamps). |
| Implementation | Single bash script. Uses `gh api graphql` + `jq` (two jq programs: per-repo normalize, then global assemble). |
| Cache | `~/.cache/gh-recap/<owner>__<name>__<hash>.json`, key = first 16 chars of `sha256(repo + since)`. Skip with `--no-cache` (also suppresses cache writes). Cache the raw GraphQL response, written atomically (temp + `mv`). |
| PR/issue bodies | Single-shot summarization (no map-reduce). Strip markdown in jq. Bot bodies dropped. Bodies > 2000 chars (post-strip) → first paragraph + first bullet group. Else full stripped body. |
| Markdown stripping | jq `gsub` with named captures. Handles code fences → `[code block]`, `<details>` → `[details]`, inline code, images → `[image]`, links → text only, headings, `**bold**`, `*italic*`, blockquotes, blank-line collapse. |
| Top-level section suppression | A `## What …` section header is only emitted if its body has content across all repos. Per-repo subsection headers (`### repo`) are only emitted if that repo has content in that class. |

## Architecture

```
gh-recap <owner/repo>... [--me <handle>] [--last-day|--last-week|--since <ISO8601>] [--no-cache] [--cache-dir DIR]
  │
  ├─ resolve window via jq (default: now - 86400 → todateiso8601)
  ├─ resolve --me via gh api user (cached at ~/.cache/gh-recap/.me) or --me flag
  │
  for each repo:
  │   ├─ cache key = sha256(repo + since)[:16]
  │   ├─ hit  → read JSON
  │   ├─ miss → gh api graphql (one query), validate, atomic-write cache
  │   ├─ validate response (errors field + .data.repository non-null) — applies
  │   │        to both cache-read and fresh-fetch paths
  │   └─ jq normalize → {repo, prs[], issues[]} with {class, lifecycle, body, …}
  │                       per item; written to a per-repo tmp blob
  │
  └─ jq assemble (slurp all tmp blobs):
        prompt intro
        + ## What you did         (repo_block(me; true))
        + ## What others did      (repo_block(other; false))
        + ## Automated activity   (repo_block(bot; false))
      with empty top-level and per-repo subsections suppressed
      → stdout: prompt text
```

## GraphQL query

One query, two connections on `repository`, per repo:

- `pullRequests(first: 50, orderBy: UPDATED_AT desc, states: [OPEN, MERGED, CLOSED])`
  with nested `reviews(first: 20)` (the `reviews` connection does not accept `orderBy` on GitHub's GraphQL schema) and `comments(first: 20, orderBy: UPDATED_AT desc)` (IssueCommentOrder only allows `UPDATED_AT`, not `CREATED_AT`)
- `issues(first: 50, orderBy: UPDATED_AT desc, states: [OPEN, CLOSED])`
  with nested `comments(first: 20, orderBy: UPDATED_AT desc)`

Filtering to the window happens in jq because GraphQL's `pullRequests`/`issues` connections don't accept a `since` parameter — see https://docs.github.com/en/graphql/reference/objects#repository.

**Why `orderBy: UPDATED_AT desc` on nested comments:** the default connection order is creation-ascending, so `first: 20` returns the *oldest* 20. On long-lived PRs/issues the recent comments (the ones inside your window) would be silently dropped. DESC guarantees the most-recent ones are always returned. We use `UPDATED_AT` because GitHub's `IssueCommentOrderField` enum only allows `UPDATED_AT` (not `CREATED_AT`). The `reviews` connection on `PullRequest` does not accept `orderBy` at all in GitHub's current GraphQL schema, so reviews are fetched in the default order; that connection can still drop recent reviews on long-lived PRs with >20 reviews — a known limitation until cursor pagination lands.

Auth = whatever `gh auth login` set up. Rate limit is 5000/hr; each repo costs ~5–10 points. https://docs.github.com/en/graphql/overview/resource-limitations

## Files

- `gh-recap` — the script
- `README.md` — usage
- `decisions.md` — this file

## Review findings folded in (from the gh-standup review and the first live run)

These were caught in review of the original `gh-standup` and during its first live run, and folded into the rewrite:

- **Bad GraphQL responses used to be cached**, then crash jq cryptically. Now validated before caching; cache is never written for error responses. Validation also runs on cache reads, so a poisoned/corrupt cache yields a clean error and tells you which file to delete.
- **Reviews/comments ordered oldest-first** silently dropped recent activity on long-lived PRs. Nested `comments` connections now use `orderBy: UPDATED_AT desc`. The `reviews` connection does not accept `orderBy` on GitHub's GraphQL schema, so it stays default-ordered (known limitation).
- **GraphQL schema mistakes found on first live run** — `reviews` doesn't accept `orderBy` at all, and `IssueCommentOrder.field` only accepts `UPDATED_AT`, not `CREATED_AT`. Both fixed.
- **`--last-day`/`--last-week` windows were rolling** (`now - 86400`), which made the cache key drift every second and the cache never hit. Now snapped to UTC day boundaries: `--last-day` = start of yesterday UTC, `--last-week` = start of 7 days ago UTC. Stable across runs in the same calendar day.
- **`echo "$RAW"` was risky** for arbitrary JSON (backslash interpretation). Replaced with `printf '%s'` everywhere JSON is piped.
- **Cache write was not atomic**, leaving corrupt files on interrupted runs. Now temp + `mv`.
- **Unused `... on User { name }`** GraphQL fragment dropped.
- **`--since` non-UTC offsets** broke lexicographic window comparisons. Now rejected; only UTC `Z` form accepted.
- **Dead `sample-prompt-output.txt` README link** removed (the file never existed).
- **`--no-cache` used to write the cache anyway.** Now skips both reads and writes.

## What's open / next steps

1. **Live test done.** First live run against `fgrehm/pi-ollama-cloud` exposed two GraphQL schema mistakes (now fixed: `reviews` doesn't accept `orderBy`; `IssueCommentOrder.field` only accepts `UPDATED_AT`) and a cache-key drift bug from rolling `--last-day` windows (now snapped to UTC day boundaries). End-to-end works, but more repos and longer windows are worth exercising, especially ones with >20 reviews on a long-lived PR (where the `reviews` default-order limitation bites).
2. **Pagination.** Capped at 50 PRs and 50 issues per repo, and 20 reviews/comments per PR/issue. For high-velocity repos on long windows this misses things. Add cursor loops if needed.
3. **Reviews you submitted** on others' PRs are not in "What you did" yet. Original goal said "PRs and issues I created"; adding reviews is a natural follow-up (group by reviewed-PR).
4. **No commit→PR linking.** LLM has to infer from merge commits. Fine for now.
5. **PR body excerpt rule** is heuristic (>2000 chars post-strip → first paragraph + first bullet group). May need tuning on real data.
6. **Prompt template is inlined in the script.** If iteration on the prompt gets tedious without editing bash, extract to `prompt.md.tmpl`.
7. **Review authors and counts vs. excerpts.** `touched-open` PRs currently surface "N review(s), M comment(s)" but not states or excerpts. Compaction was a deliberate tradeoff; revisit if standups need "who approved what" detail.

## Things to do first on resume

1. `chmod +x gh-recap` and put it on `$PATH`.
2. `gh auth status` green, `jq --version` works.
3. Live run already done against `fgrehm/pi-ollama-cloud` (see open items #1). Try a few more repos you actively work on, especially combos:
   - One calm repo (`gh-recap org/repo`) to sanity-check the prompt shape.
   - Multi-repo (`gh-recap org/web org/api org/infra --last-week`) to exercise per-repo subsections.
4. Pipe to your LLM of choice. Iterate on the prompt instructions inline in the `ASSEMBLE_JQ` block if the output isn't what you want.
5. If a repo has >50 PRs/issues with activity per day, add pagination.

## Prior art surveyed (none reused)

Original `gh-standup` survey. Kept for provenance; the current `gh-recap` scope ("your recent activity across repos") is even less crowded.

| Tool | What it is | Why not |
|---|---|---|
| [`gh-dash`](https://github.com/dlvhdr/gh-dash) | TUI dashboard | No summarization, wrong shape (interactive vs. piped) |
| [`git-standup`](https://github.com/kamranahmedse/git-standup) | "What did I commit?" CLI | Commits only, no PRs/issues/reviews, no LLM output |
| [`spencerkimball/repo-digest`](https://github.com/spencerkimball/repo-digest) | Daily HTML digest of repo PR activity | Closest in *shape*, but: 9 years stale (last meaningful work 2016), 41 stars, Go (rewrite to reuse), REST-era code (no GraphQL), HTML template not LLM prompt. Concept influenced our design (open vs. recently-merged PRs ordered by diff size) but nothing portable. |
| [`tweag/work-daigest`](https://github.com/tweag/work-daigest) | Python + AWS Bedrock; single-user weekly digest across GitHub + Google Calendar | Single-user (`--github-handle`), not repo-wide. Multi-source. Tied to Bedrock. |
| [`flows-network/github-pr-summary`](https://github.com/flows-network/github-pr-summary) | LLM-summarizes a single PR, posts as comment | Per-PR not per-day. Different unit. |
| [`abhijeetps/weekly-digest`](https://github.com/abhijeetps/weekly-digest) | Probot app, weekly digest posted as issue | Hosted/Probot, weekly, no LLM. 2018 GSoC project. |
| [Gitmore](https://gitmore.io/) | SaaS: daily GitHub digest, AI-summarized, delivered to Slack | SaaS. If "no-build" is acceptable, this is the closest product. Rejected per constraints (CLI, no signups). |
| [Gitingest](https://gitingest.com/) | Codebase → LLM-friendly text snapshot | Different problem (code, not activity). |

**Verdict:** related products exist, but nothing is a CLI that emits an LLM prompt summarizing your recent activity across repos. The original `gh-standup` build was justified for its team-standup scope; the `gh-recap` rewrite extends it to the personal-refresher scope under a new name.