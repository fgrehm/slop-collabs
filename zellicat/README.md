# zellicat

Run a command in a stacked [zellij](https://zellij.dev) pane and capture its output as if you had run it directly.

zellij can launch a command in a pane, but it cannot hand that command's output back to the caller. There is an open PR for this ([zellij-org/zellij#4630](https://github.com/zellij-org/zellij/pull/4630)); until it lands in a release, `zellicat` fakes it.

## Usage

```sh
zellicat [zellij-run options] -- COMMAND [ARGS...]
zellicat COMMAND [ARGS...]
```

```sh
# capture into a variable, see it run live in a stacked pane
result=$(zellicat -- ./long-build.sh)

# exit code is propagated
zellicat -- some-flaky-test || echo "test failed"

# forward options to `zellij run` (here: a floating pane instead of stacked)
zellicat --floating -- htop
```

## How it works

1. `zellicat` runs your command in a new pane via `zellij run`, wrapped so the pane executes `COMMAND 2>&1 | tee tmpfile; echo $? > rcfile`.
2. `tee` keeps the output visible live in the pane *and* writes a byte-exact copy to a temp file. Because `tee` sits in the pipeline, the shell waits for it to flush before recording the exit code.
3. `zellicat` waits for the exit-code file to appear, prints the captured output to its own stdout, and exits with the command's exit code.

This avoids `zellij action dump-screen`, which only returns the *rendered* viewport (long lines wrapped to pane width, not raw bytes).

## Defaults and overrides

`zellicat` adds these `zellij run` options unless you pass an equivalent:

- `--stacked` (skipped if you pass `--floating`, `--in-place`, or `--direction`)
- `-c` / `--close-on-exit`, so the pane disappears when the command finishes
- `-n` / `--name`, defaulting to `zellicat: <command>`

`ZELLICAT_TIMEOUT=<seconds>` aborts the wait if the command never finishes (e.g. the pane was force-closed). Default `0` waits forever.

## Limitations

- stdout and stderr are merged into one stream.
- The command does not receive `zellicat`'s stdin.
- Output is emitted only after the command exits, not streamed line by line.
- Must be run from inside a zellij session.

## Requirements

- zellij (developed against 0.44.1)
- `bash`
