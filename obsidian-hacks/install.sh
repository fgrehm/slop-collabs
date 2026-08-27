#!/usr/bin/env bash
set -euo pipefail

vault_dir="${OBSIDIAN_VAULT:-$HOME/Obsidian}"
obsidian_dir="$vault_dir/.obsidian"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugins_dir="$obsidian_dir/plugins"
plugin_id="obsidian-hacks"

printf 'Building plugin...\n'
rm -rf "$source_dir/dist"
(cd "$source_dir" && npm run build)

plugin_target="$plugins_dir/$plugin_id"
mkdir -p "$plugin_target"

# Assemble the install artifact, then mirror it to the vault. --delete keeps
# removed plugin files from lingering in the vault.
mkdir -p "$source_dir/dist"
cp "$source_dir/manifest.json" "$source_dir/dist/"
rsync --archive --delete "$source_dir/dist/" "$plugin_target/"
printf 'Installed plugin %s to %s\n' "$plugin_id" "$plugin_target"
