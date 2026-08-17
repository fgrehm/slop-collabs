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

From this directory:

```sh
cargo run -- --interval 1 --duration 300 \
  --csv webkit-poc.csv --json webkit-poc.json -- \
  cargo run --manifest-path ../webkit-poc/Cargo.toml --features gui
```

The TUI shows the current aggregate and process rows. Press `q` or `Esc` to
stop the measured command. Use `--no-tui` for CI or scripted runs:

```sh
cargo run -- --no-tui --interval 1 --duration 60 \
  --csv chromium.csv --json chromium.json -- \
  chromium https://web.whatsapp.com
```

Use `--inherit-output` when the measured command's stdout/stderr should remain
visible. By default output is hidden so it cannot corrupt the TUI.

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
