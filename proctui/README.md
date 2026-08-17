# proctui

A small Linux-only Rust TUI for measuring an arbitrary command and its process
group. It is aimed at comparisons such as bare WebKitGTK vs `pmmaapp` vs
Chromium, where the interesting work happens in subprocesses.

It samples:

- aggregate CPU (100% means one fully-used core; multi-process workloads can exceed 100%)
- aggregate resident memory (RSS)
- process count
- each process's CPU and RSS in the live view and JSON export

The command is placed in its own process group, so descendants such as browser
helper processes are included without a daemon or Python runtime.

## Run

`proctui` separates starting a workload from observing it. This lets an interactive application retain its terminal while the monitor runs elsewhere.

In the first terminal, start the application normally through `proctui`:

```sh
cargo run -- run --inherit-output --pid-file /tmp/webkit.pgid -- \
  cargo run --manifest-path ../webkit-poc/Cargo.toml --features gui
```

It prints its process group ID and an attach command. In a second terminal, open the live TUI:

```sh
cargo run -- attach --pgid "$(cat /tmp/webkit.pgid)" \
  --csv webkit-timeline.csv --json webkit-run.json
```

You can also attach from an existing process PID. `proctui` resolves its process group once:

```sh
cargo run -- attach --pid "$(pgrep -n chromium)"
```

The TUI shows the current aggregate and process rows. Press `q` or `Esc` to stop observing. Attached workloads are never killed. A launched workload is killed as a process group when it reaches `--duration` or when its own TUI is stopped.

`--csv` writes aggregate timeline rows (`elapsed_seconds`, CPU, RSS, and process count). `--json` writes those samples plus the process rows visible at each sample. Use `--no-tui` for CI or scripted runs.

## View saved runs

Open either export in a playback TUI:

```sh
cargo run -- view webkit-run.json
cargo run -- view webkit-timeline.csv
```

Use left/right (or `h`/`l`) to move between samples and Space to play. JSON includes the per-process table. CSV contains aggregate values only.

Use `run` without `--inherit-output` for noninteractive commands. With `--inherit-output`, `proctui` does not open a TUI, so the child has exclusive terminal access.

## Design notes and limitations

This first increment intentionally stays small and Linux-specific: it reads
`/proc`, uses `setpgid`, and exports samples rather than pretending to be a
complete profiler. RSS is summed across the process group, so shared pages may
be counted more than once. CPU is based on `/proc/<pid>/stat` deltas and is
reported relative to one core. Process groups created by a child itself are not
included.

The existing tools remain useful: `btop`/`htop` are excellent interactive
system monitors, `pidstat` and `atop` are mature system-wide recorders, and
CCTools `resource_monitor` is a more featureful command wrapper. `proctui` is
specifically the small native Rust/TUI niche: one command, descendants,
readable live view, and simple CSV/JSON artifacts.
