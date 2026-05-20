# zellicat

> [!WARNING]
> This was done over a single 30min Claude Code session with Opus 4.7 on 2026-05-19.

Run a command in a [zellij](https://zellij.dev) pane and capture its result.

zellij can launch a command in a pane, but it cannot hand that command's result back to the caller. There is an open PR for this ([zellij-org/zellij#4630](https://github.com/zellij-org/zellij/pull/4630)); until it lands in a release, `zellicat` fakes it.

## Usage

```sh
zellicat [zellij-run options] -- COMMAND [ARGS...]
zellicat COMMAND [ARGS...]
```

The command runs in the pane with a real, untouched tty, and reports its result by writing to the file named in the `$ZELLICAT_OUT` environment variable. `zellicat` prints that file once the command exits, and exits with its code.

```sh
# capture a result into a variable
result=$(zellicat -- sh -c 'echo "the answer" > "$ZELLICAT_OUT"')

# the command can run a full TUI (editor, picker) and still report a result;
# the pane is a real terminal, so the TUI -- mouse and all -- just works
picked=$(zellicat -- sh -c 'fzf > "$ZELLICAT_OUT"')

# exit code is propagated
zellicat -- ./flaky-test.sh || echo "test failed"

# forward options to `zellij run` (here: a floating pane instead of stacked)
zellicat --floating -- ./pick-a-thing.sh
```

## How it works

This is the trick from [revdiff](https://github.com/umputun/revdiff)'s terminal launcher.

Capturing a command's stdout means piping it, and a pipe is not a tty. Terminal programs (`nvim`, `fzf`, anything with a UI) negotiate with their terminal over that same stdout, so piping it garbles or breaks them. You cannot both capture stdout and keep it a tty.

So `zellicat` does not touch stdout at all:

1. It writes a small launch script and runs it via `zellij run`. The script runs your command with stdin, stdout and stderr all on the pane's real tty.
2. Your command writes whatever should be captured to `$ZELLICAT_OUT` (a temp file `zellicat` created and exported), then exits. The launch script records the exit code in a sentinel file.
3. `zellicat` waits for the sentinel, prints `$ZELLICAT_OUT`, and exits with the command's exit code.

The result travels back out-of-band, so the command's terminal is never disturbed.

## Defaults and overrides

`zellicat` adds these `zellij run` options unless you pass an equivalent:

- `--stacked` (skipped if you pass `--floating`, `--in-place`, or `--direction`)
- `-c` / `--close-on-exit`, so the pane disappears when the command finishes
- `-n` / `--name`, defaulting to `zellicat: <command>`

`ZELLICAT_TIMEOUT=<seconds>` aborts the wait if the command never finishes (e.g. the pane was force-closed). Default `0` waits forever.

## Limitations

- The command must opt in to being captured by writing to `$ZELLICAT_OUT`. Plain stdout is *not* captured: it shows live in the pane and is discarded.
- A bare command that only writes to stdout (`zellicat -- echo hi`) captures nothing. Redirect it: `zellicat -- sh -c 'echo hi > "$ZELLICAT_OUT"'`.
- Output is emitted only after the command exits, not streamed line by line.
- Must be run from inside a zellij session.

## Requirements

- zellij (developed against 0.44.1)
- `bash`
