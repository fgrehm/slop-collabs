# proctui

A small Linux-only Rust TUI for measuring an arbitrary command and its process
group. It is aimed at comparisons such as bare WebKitGTK vs `pmmaapp` vs
Chromium, where the interesting work happens in subprocesses.

It samples:

- aggregate CPU (100% means one fully-used core; multi-process workloads can exceed 100%)
- aggregate resident memory (RSS), proportional memory (PSS), and unique memory (USS)
- process count
- each process's parent, CPU, RSS, PSS, and USS in the live view and JSON export

The command is placed in its own process group, so descendants such as browser helper processes are included without a daemon or Python runtime.

## What the numbers mean

- **CPU:** 100% means one CPU core was fully busy during the sample. A browser using two cores can show 200%.
- **RSS:** Memory currently mapped into each process. Adding RSS across processes can count shared WebKit, GTK, and library pages more than once, so treat it as an upper bound.
- **PSS:** Shared pages are divided among the processes using them. The summed PSS is the best headline estimate for how much physical memory the measured workload is responsible for.
- **USS:** Memory used only by this workload's processes, with no shared pages included. It is useful for finding private growth, but understates the workload's total footprint because shared pages still consume memory.
- **Process count:** The number of live processes in the measured process group at that sample.

For example, `1.14 GiB PSS`, `1.67 GiB RSS`, and `1.02 GiB USS` means the workload is responsible for about 1.14 GiB of memory. Its per-process RSS adds up to 1.67 GiB because some pages are shared, while 1.02 GiB is private to its processes.

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

`--csv` writes aggregate timeline rows (`elapsed_seconds`, CPU, RSS, PSS, USS, and process count). `--json` writes those samples plus the process rows visible at each sample. Use `--no-tui` for CI or scripted runs.

## View saved runs

Open either export in a playback TUI:

```sh
cargo run -- view webkit-run.json
cargo run -- view webkit-timeline.csv
```

Use left/right (or `h`/`l`) to move between samples and Space to play. JSON includes the per-process table. CSV contains aggregate values only.

Use `run` without `--inherit-output` for noninteractive commands. With `--inherit-output`, `proctui` does not open a TUI, so the child has exclusive terminal access.

## Design notes and limitations

This first increment intentionally stays small and Linux-specific: it reads `/proc`, uses `setpgid`, and exports samples rather than pretending to be a complete profiler. RSS is summed across the process group, so shared pages may be counted more than once. PSS from `/proc/<pid>/smaps_rollup` apportions shared pages, while USS is `Private_Clean + Private_Dirty`. CPU is based on `/proc/<pid>/stat` deltas and is reported relative to one core. Process groups created by a child itself are not included.

The existing tools remain useful: `btop`/`htop` are excellent interactive
system monitors, `pidstat` and `atop` are mature system-wide recorders, and
CCTools `resource_monitor` is a more featureful command wrapper. `proctui` is
specifically the small native Rust/TUI niche: one command, descendants,
readable live view, and simple CSV/JSON artifacts.
