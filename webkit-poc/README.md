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

[`resource_monitor`](https://ccl.cse.nd.edu/software/) is a compiled CLI from
[Cooperative Computing Tools (CCTools)](https://ccl.cse.nd.edu/software/). It
runs an arbitrary command, tracks its complete process tree, and writes JSON
summary and time-series files. Install it on Ubuntu with:

```sh
sudo apt install coop-computing-tools
```

Run the PoC under measurement for five minutes, sampling once per second:

```sh
resource_monitor \
  --interval=1 \
  --with-output-files=webkit-poc \
  --with-time-series \
  --without-disk-footprint \
  -- cargo run --features gui
```

Run from this directory, or use an explicit manifest path from elsewhere:

```sh
resource_monitor \
  --interval=1 \
  --with-output-files=webkit-poc \
  --with-time-series \
  --without-disk-footprint \
  -- cargo run --manifest-path /tmp/slop-collabs/webkit-poc/Cargo.toml --features gui
```

This produces `webkit-poc.summary` and `webkit-poc.series`. For a running
process, `resource_monitor --pid PID` can attach to it, though wrapping the
command is more accurate and reliably captures descendants.

Use the same duration, interval, page, and interaction phase when comparing the
PoC with Chrome/Chromium or `pmmaapp`. Tracking the complete process tree matters
because WebKit runs work in subprocesses. Keep generated measurement files as
local artifacts rather than treating them as source files.
