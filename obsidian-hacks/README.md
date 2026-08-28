# Obsidian stuff

A single Obsidian plugin for CSS and JavaScript experiments. Source files and build configuration are committed; the build combines `src/styles.css` with `task-icons.json` into generated files in `dist/`.

## Layout

- `src/task-icons.json` - Task marker to emoji mapping.
- `scripts/generate-css.mjs` - Combines the base CSS and task-icon mapping during builds.
- `src/main.ts` - TypeScript plugin code and experiments.
- `src/styles.css` - Hand-written base CSS.
- `manifest.json`, `package.json`, `esbuild.config.mjs`, `tsconfig.json` - Plugin metadata and build infrastructure.

## Plugin layout

Each plugin directory should contain the files Obsidian loads from that plugin's install directory:

```text
plugins/<plugin-id>/
├── main.js
├── manifest.json
└── styles.css  # optional
```

Source code and build configuration can live alongside those files when a plugin needs to be built. Keep generated bundles out of version control only when they can be reproduced locally; Obsidian needs `main.js` in the installed plugin directory.

## Install

Install the collected CSS into the default vault with:

```sh
./install.sh
```

Set `OBSIDIAN_VAULT` to install into another vault:

```sh
OBSIDIAN_VAULT="$HOME/path/to/vault" ./install.sh
```

The script builds a `dist/` install artifact and mirrors it with `rsync --delete` into `.obsidian/plugins/obsidian-hacks/`, including `styles.css`:

```sh
cd obsidian-hacks
npm install
./install.sh
```

After installation, open Obsidian settings, go to **Community plugins**, refresh the list of installed plugins, and then enable **Obsidian Hacks**. To see changes after reinstalling, run **Reload app without saving** from the command palette (`Ctrl+P`).

## Debugging

On Obsidian Desktop, open Developer Tools with `Ctrl+Shift+I` (or `Cmd+Option+I` on macOS). Use the **Console** tab to inspect task elements:

```js
document.querySelectorAll('li[data-task="/"]')
```

Select a task in the Elements tab and inspect its surrounding markup with:

```js
$0.closest("li").outerHTML
```

Developer Tools are not available on Obsidian mobile.

## CSS notes

CSS in this directory may depend on a particular theme or community plugin. Keep source URLs and compatibility notes near copied rules, and prefer one focused snippet per file once a rule set becomes stable.
