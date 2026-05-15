# gh-standup — decisions & state

A small bash CLI that emits an LLM-ready prompt summarizing a GitHub repo's recent activity. Pipe to any LLM (`gh-standup … | llm`, `| claude`, `| pbcopy`).

## Goal

Daily team standup summary for **one repo**, all authors (humans + bots), output to stdout for piping to any LLM.

## Decisions

| Question | Decision |
|---|---|
| Use case | Team standup |
| Scope of "activity" | PRs (opened/merged/closed/reviews/comments) + issues (opened/closed/comments). **No raw commits** — everything goes through PRs. |
| Whose activity | Everyone active in the repo |
| Output | Stdout. Tool emits prompt only; never calls an LLM. |
| Time window | `--since <ISO8601>` required. Punted on calendar math; user passes `date -u -d '1 day ago' +%FT%TZ`. |
| Group-by | Single narrative for the whole repo. Bots segregated into separate section, with instructions for the LLM to aggregate bot activity rather than enumerate. |
| Implementation | Single bash script, ~355 lines. Uses `gh api graphql` + `jq`. |
| Cache | `~/.cache/gh-standup/<owner>__<name>__<hash>.json`, key = sha256(repo + since). Skip with `--no-cache`. Cache the raw GraphQL response. |
| Bots | Included by default. Detected via `author.__typename == "Bot"` (primary) + `[bot]` suffix on login (fallback). |
| PR/issue bodies | Single-shot summarization (no map-reduce). Strip markdown in jq. Bot bodies dropped. Bodies > 2000 chars → first paragraph + bullets. Else full stripped body. |
| Markdown stripping | jq `gsub` with named captures. Handles code fences → `[code block]`, inline code, images → `[image]`, links → text only, headings, `**bold**`, `*italic*`, blockquotes, blank-line collapse. |

## Architecture

```
gh-standup <owner/repo> --since <ISO8601> [--no-cache] [--cache-dir DIR]
  │
  ├─ validate args (ISO 8601 regex check)
  ├─ cache key = sha256(repo + since)[:16]
  ├─ hit  → read JSON
  ├─ miss → gh api graphql (one query), write cache
  ├─ jq pass 1: filter to events with any activity in window,
  │             strip markdown, bucket by event type, mark bots
  ├─ jq pass 2: assemble prompt (system + counts + sectioned event log)
  └─ stdout: prompt text
```

## GraphQL query

Single query, two connections on `repository`:
- `pullRequests(first: 50, orderBy: UPDATED_AT desc, states: [OPEN, MERGED, CLOSED])`
  with nested `reviews(first: 20)` and `comments(first: 20)`
- `issues(first: 50, orderBy: UPDATED_AT desc, states: [OPEN, CLOSED])`
  with nested `comments(first: 20)`

Filtering to the window happens in jq because GraphQL's `pullRequests`/`issues` connections don't accept a `since` parameter — see https://docs.github.com/en/graphql/reference/objects#repository.

Auth = whatever `gh auth login` set up. Rate limit is 5000/hr; this query is ~5–10 points. https://docs.github.com/en/graphql/overview/resource-limitations

## Files

- `gh-standup` — the script
- `sample-prompt-output.txt` — what the script emits when run against the fixture

## What's open / next steps

1. **Pagination**: capped at 50 most-recently-updated PRs and 50 issues. For high-velocity repos this could miss things on long windows. Add cursor loop if needed.
2. **No `date` parsing**: user passes an ISO 8601 timestamp explicitly. The README example uses `date -u -d '1 day ago' +%FT%TZ` (Linux) / `gdate` (macOS w/ coreutils). If awkward, swap in `dateutils` or a Python shim.
3. **Forks / non-default-branch commits don't appear at all** — only PRs do. Matches "everything goes through PRs" decision.
4. **No commit→PR linking** — LLM has to infer. Fine for now.
5. **PR body excerpt rule** is heuristic (>2000 chars triggers first-para+bullets). May need tuning on real data — some teams write 200-char essays, others write 5000-char checklists.
6. **`gh` not available in this sandbox** — script tested against a fixture file primed into the cache dir. End-to-end live test still needs to run on your machine: `./gh-standup OWNER/REPO --since "$(date -u -d '1 day ago' +%FT%TZ)"`.
7. **Prompt template is inlined in the script**. If you want to iterate on the prompt without editing bash, future refactor: extract to `prompt.md.tmpl`.

## Things to do first on resume

1. Drop `gh-standup` on `$PATH`, `chmod +x`.
2. Confirm `gh auth status` is green and `jq --version` works.
3. Run live against a real repo you care about; verify the prompt shape.
4. Pipe to your LLM of choice; iterate on the system instructions inline in the script if the output isn't what you want.
5. If a repo has >50 PRs/issues with activity per day, add pagination.

## Prior art surveyed (none reused)

| Tool | What it is | Why not |
|---|---|---|
| [`gh-dash`](https://github.com/dlvhdr/gh-dash) | TUI dashboard | No summarization, wrong shape (interactive vs. piped) |
| [`git-standup`](https://github.com/kamranahmedse/git-standup) | "What did I commit?" CLI | Commits only, no PRs/issues/reviews, no LLM output |
| [`spencerkimball/repo-digest`](https://github.com/spencerkimball/repo-digest) | Daily HTML digest of repo PR activity | Closest in *shape*, but: 9 years stale (last meaningful work 2016), 41 stars, Go (rewrite to reuse), REST-era code (no GraphQL), HTML template not LLM prompt. Concept influenced our design (open vs. recently-merged PRs ordered by diff size) but nothing portable. |
| [`tweag/work-daigest`](https://github.com/tweag/work-daigest) | Python + AWS Bedrock; single-user weekly digest across GitHub + Google Calendar | Single-user (`--github-handle`), not repo-wide. Multi-source. Tied to Bedrock. |
| [`flows-network/github-pr-summary`](https://github.com/flows-network/github-pr-summary) | LLM-summarizes a single PR, posts as comment | Per-PR not per-day. Different unit. |
| [`abhijeetps/weekly-digest`](https://github.com/abhijeetps/weekly-digest) | Probot app, weekly digest posted as issue | Hosted/Probot, weekly, no LLM. 2018 GSoC project. |
| [Gitmore](https://gitmore.io/) | SaaS: daily GitHub digest, AI-summarized, delivered to Slack | SaaS. If "no-build" is acceptable, this is the closest product. Rejected per constraints (single repo, CLI, no signups). |
| [Gitingest](https://gitingest.com/) | Codebase → LLM-friendly text snapshot | Different problem (code, not activity). |

**Verdict:** related products exist, but nothing is a CLI that emits an LLM prompt summarizing one repo's daily activity. Building was justified. Total time saved by surveying first: confirmed we weren't duplicating, picked up the open-vs-merged-PRs framing from `repo-digest`.
