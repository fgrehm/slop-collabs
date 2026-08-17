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

[`psrecord`](https://github.com/astrofrog/psrecord) records CPU and memory
activity for an arbitrary process, including its subprocesses, and can write a
log plus a plot. Install it with `pipx`:

```sh
pipx install psrecord
```

Run the PoC under measurement for five minutes, sampling once per second:

```sh
psrecord \
  'cargo run --features gui' \
  --interval 1 \
  --duration 300 \
  --include-children \
  --log webkit-poc.log \
  --plot webkit-poc.png
```

Run from this directory, or use an explicit manifest path from elsewhere:

```sh
psrecord \
  'cargo run --manifest-path /tmp/slop-collabs/webkit-poc/Cargo.toml --features gui' \
  --interval 1 --duration 300 --include-children \
  --log webkit-poc.log --plot webkit-poc.png
```

For a running process, pass its PID instead:

```sh
psrecord "$PID" --interval 1 --include-children \
  --duration 300 --log webkit-poc.log --plot webkit-poc.png
```

Use the same duration, interval, page, and interaction phase when comparing the
PoC with Chrome/Chromium or `pmmaapp`. `--include-children` matters because
WebKit runs work in subprocesses. Keep the generated logs and plots as local
measurement artifacts rather than treating them as source files.
