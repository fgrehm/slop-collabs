# WebKitGTK 6 PoC

A deliberately small Linux harness for comparing a bare GTK 4 + WebKitGTK 6
window with browser and future PMMA implementations. It currently loads
WhatsApp Web by default and accepts another HTTP(S) URL for local experiments.

This is not a PMMA port and intentionally contains no PMMA policy, injected
scripts, ad blocking, tray integration, notifications, or profiling logic.

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

## Comparison notes

Keep the workload and observation window consistent when comparing this harness
with Chrome/Chromium and a future PMMA backend. Record idle visible/obscured/
hidden CPU, scrolling CPU, message-arrival CPU, memory, and WebKit subprocess
CPU. Do not add settings or optimizations until the bare harness establishes a
baseline.
