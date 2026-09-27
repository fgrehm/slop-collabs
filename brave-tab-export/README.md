# Tab Export

A Manifest V3 extension for Brave (or Chrome) that exports the URLs of your tab groups to a Markdown file, so you can process them elsewhere.

Written as a vibe-coded scratch project. It is read-only: it never closes, moves, or modifies a tab. No options page, no storage, no history.

## Install

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** and select this directory.

## Use

Click the extension icon. The popup lists every group in every window, with tab counts and the group color.

- **Select all / Select none** to choose which groups are in scope.
- **Copy** puts the Markdown on the clipboard.
- **Export to file** writes a `tab-groups-YYYY-MM-DD.md` to your downloads, via a save dialog.

The extension has no write operations. Once a group is closed by hand, its URLs are gone.

## Output format

```markdown
# Tab groups

Exported 2026-09-27T12:34:56.789Z.

## 1. pi plugins (blue)

- https://example.com/a
- https://example.com/b
```

Groups are numbered in tab-strip order. Every tab is emitted, including pinned tabs and duplicates. Ungrouped tabs are skipped.

## Notes and limitations

- **Closed groups are invisible, permanently.** `chrome.tabGroups.query()` only returns groups that currently have live tabs. Once a group is empty, the browser discards it and there is no API, native or otherwise, to read it back. Brave's own "Save group" feature persists closed groups, but that data lives in Brave's internal store and is not exposed to any extension. **Export before you close, not after.**
- **Group identity is per session.** Tab group ids are not stable across restarts, which is fine here because nothing is persisted.
- **The `tabs` permission is used for reading only.** Nothing here opens or closes a tab.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read every window's tab list, including URLs. |
| `tabGroups` | Read group titles, colors, and order. |
| `downloads` | Write the Markdown file, for the export-to-file option. |
