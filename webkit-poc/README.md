# WebKitGTK 6 PoC

A deliberately small Linux harness for comparing a bare GTK 4 + WebKitGTK 6
window with browser and future `pmmaapp` implementations. It currently loads
WhatsApp Web by default and accepts another HTTP(S) URL for local experiments.

This is not a `pmmaapp` port and intentionally contains no `pmmaapp` policy,
injected scripts, ad blocking, tray integration, notifications, or profiling
logic.

## Requirements

- Rust (the repository's mise configuration provides it)
- GTK 4 development files
- WebKitGTK 6.0 development files

On Ubuntu 24.04:

```sh
sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev
```

The equivalent package names should be used on Arch and Debian 13; verify them
against those distributions rather than assuming Ubuntu names are portable.

## Run

Run the logic tests without GTK/WebKit system libraries:

```sh
cargo test
```

After installing the native development packages:

```sh
cargo run --features gui
cargo run --features gui -- --url https://example.com
```

The default URL is `https://web.whatsapp.com`.

## Resource measurement

For a native, command-focused TUI, use [`proctui`](../proctui). It launches a
command in its own Linux process group, includes browser/WebKit subprocesses,
and displays aggregate and per-process CPU/RSS. It can also write CSV and JSON
samples without a Python runtime:

```sh
cargo run --manifest-path ../proctui/Cargo.toml -- \
  --interval 1 \
  --duration 300 \
  --csv webkit-poc.csv \
  --json webkit-poc.json \
  -- cargo run --features gui
```

For scripted or headless measurements, add `--no-tui`:

```sh
cargo run --manifest-path ../proctui/Cargo.toml -- \
  --no-tui --interval 1 --duration 300 \
  --csv webkit-poc.csv --json webkit-poc.json \
  -- cargo run --features gui
```

The same runner can compare `pmmaapp` or Chromium. Keep the duration, interval,
page, and interaction phase consistent. See the
[`proctui README`](../proctui/README.md) for design limitations and details.

For a more featureful alternative, [`resource_monitor`](https://ccl.cse.nd.edu/software/)
from [Cooperative Computing Tools (CCTools)](https://ccl.cse.nd.edu/software/)
runs arbitrary commands and writes summary/time-series files. It is available
on Ubuntu with:

```sh
sudo apt install coop-computing-tools
```

Use either tool to compare Chrome/Chromium, `pmmaapp`, and the bare WebKit
harness. Tracking the complete process group/tree matters because WebKit runs
work in subprocesses. Keep generated measurement files as local artifacts
rather than treating them as source files.
