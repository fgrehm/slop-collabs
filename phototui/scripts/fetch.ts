#!/usr/bin/env bun

/**
 * Downloads a hardcoded set of Unsplash photos into ./cache (gitignored).
 * No API key needed: images.unsplash.com serves photos by ID directly.
 *
 * The viewer only ever reads a directory of image files from disk, so
 * swapping this source out later (local folder, real API) is a no-op there.
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// { id, file, alt } - a loose mix of subjects and aspect ratios.
const PHOTOS = [
  { id: "1506905925346-21bda4d32df4", file: "mountain.jpg" },
  { id: "1501785888041-af3ef285b470", file: "lake.jpg" },
  { id: "1507525428034-b723cf961d3e", file: "beach.jpg" },
  { id: "1519681393784-d120267933ba", file: "night-sky.jpg" },
  { id: "1470071459604-3b5ec3a7fe05", file: "foggy-forest.jpg" },
  { id: "1472214103451-9374bd1c798e", file: "field.jpg" },
  { id: "1469474968028-56623f02e42e", file: "valley.jpg" },
  { id: "1475924156734-496f6cac6ec1", file: "ocean.jpg" },
  { id: "1433086966358-54859d0ed716", file: "river.jpg" },
  { id: "1441974231531-c6227db76b6e", file: "forest.jpg" },
  { id: "1470813740244-df37b8c1edcb", file: "milky-way.jpg" },
  { id: "1500530855697-b586d89ba3ee", file: "lake-dock.jpg" },
  { id: "1447752875215-b2761acb3c5d", file: "mountain-lake.jpg" },
  { id: "1458668383970-8ddd3927deed", file: "peaks.jpg" },
  { id: "1440342359743-84fcb8c21f21", file: "canyon.jpg" },
  { id: "1465146344425-f00d5f5c8f07", file: "flower.jpg" },
]

const CACHE_DIR = resolve(import.meta.dir, "..", "cache")
const WIDTH = "800"

async function fetchPhoto(id: string, file: string): Promise<boolean> {
  const dest = join(CACHE_DIR, file)
  if (existsSync(dest)) {
    console.log(`skip   ${file} (already present)`)
    return true
  }
  const url = `https://images.unsplash.com/photo-${id}?w=${WIDTH}`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`fail   ${file} (HTTP ${res.status})`)
    return false
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  writeFileSync(dest, bytes)
  console.log(`saved  ${file} (${(bytes.length / 1024).toFixed(1)} KiB)`)
  return true
}

mkdirSync(CACHE_DIR, { recursive: true })

console.log(`downloading ${PHOTOS.length} photos into ${CACHE_DIR}\n`)
const results = await Promise.all(PHOTOS.map((p) => fetchPhoto(p.id, p.file)))
const ok = results.filter(Boolean).length
console.log(`\ndone: ${ok}/${PHOTOS.length} present in ${CACHE_DIR}`)
process.exit(ok === PHOTOS.length ? 0 : 1)
