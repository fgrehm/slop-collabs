#!/usr/bin/env bun

/**
 * Duplicate the cached photos to a target count, to stress-test the
 * virtualized grid without re-downloading. Idempotent: clears any prior
 * `dup-` files first so re-running lands on exactly `--count` images.
 *
 *   bun run scale              # default 500
 *   bun run scale --count 2000
 */

import { mkdirSync, readdirSync, rmSync, copyFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const CACHE_DIR = resolve(import.meta.dir, "..", "cache")
const args = process.argv.slice(2)
let count = 500
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" && args[i + 1]) count = Number(args[++i])
}

// Keep the original photos; drop any prior duplicates so the total is exact.
const originals = readdirSync(CACHE_DIR)
  .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f) && !f.startsWith("dup-"))
  .sort()
if (originals.length === 0) {
  console.error("no original photos in ./cache - run `bun run fetch` first")
  process.exit(1)
}
for (const f of readdirSync(CACHE_DIR).filter((f) => f.startsWith("dup-"))) {
  rmSync(join(CACHE_DIR, f))
}

mkdirSync(CACHE_DIR, { recursive: true })
let made = 0
for (let i = 0; i < count; i++) {
  const src = join(CACHE_DIR, originals[i % originals.length]!)
  const dest = join(CACHE_DIR, `dup-${String(i).padStart(4, "0")}-${originals[i % originals.length]}`)
  if (!existsSync(dest)) copyFileSync(src, dest)
  made++
}

console.log(`scaled ./cache to ${made} duplicates (on top of ${originals.length} originals)`)