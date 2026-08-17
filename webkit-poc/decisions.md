# WebKitGTK PoC decisions

## Scope

This first increment is a standalone load harness, not the `pmmaapp` migration.
Its purpose is to establish a minimal direct GTK 4 + WebKitGTK 6 execution path and
a baseline for the WhatsApp CPU question.

## Package shape

The GUI dependencies are optional behind the `gui` feature. This lets the pure
URL/argument policy compile and test on machines that do not yet have native
GTK/WebKit development packages installed. It also makes the dependency
boundary explicit without inventing a WebView trait or backend abstraction.

The GUI remains one small `main.rs`: there is not enough application behavior
yet to justify splitting it into window, session, navigation, and platform
modules.

## Current limitation

The current host does not have `gtk4` or `webkitgtk-6.0` available through
`pkg-config`, so the GUI build cannot be verified here until those system
packages are installed. The Rust crate choices are `gtk4` 0.11 and `webkit6`
0.6, which target GTK 4 and WebKitGTK 6.0 respectively.
