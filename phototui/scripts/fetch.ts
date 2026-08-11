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
  // cities & architecture
  { id: "1477959858617-67f85cf4f1df", file: "city-night.jpg" },
  { id: "1449824913935-59a10b8d2000", file: "city-skyline.jpg" },
  { id: "1444723121867-7a241cacace9", file: "building.jpg" },
  { id: "1480714378408-67cf0d13bc1b", file: "street.jpg" },
  { id: "1486406146926-c627a92ad1ab", file: "office-building.jpg" },
  { id: "1511818966892-d7d671e672a2", file: "bridge.jpg" },
  { id: "1502602898657-3e91760cbb34", file: "paris.jpg" },
  // people & lifestyle
  { id: "1494790108377-be9c29b29330", file: "portrait-woman.jpg" },
  { id: "1500648767791-00dcc994a43e", file: "portrait-man.jpg" },
  { id: "1519345182560-3f2917c472ef", file: "surfing.jpg" },
  { id: "1507003211169-0a1dd7228f2d", file: "portrait-dog.jpg" },
  { id: "1517841905240-472988babdf9", file: "portrait-cat.jpg" },
  { id: "1524504388940-b1c1722653e1", file: "portrait-woman2.jpg" },
  { id: "1544005313-94ddf0286df2", file: "portrait-woman3.jpg" },
  { id: "1506794778202-cad84cf45f1d", file: "portrait-man2.jpg" },
  { id: "1521119989659-a83eee488004", file: "portrait-man3.jpg" },
  { id: "1529626455594-4ff0802cfb7e", file: "portrait-woman4.jpg" },
  { id: "1502823403499-6ccfcf4fb453", file: "portrait-plant.jpg" },
  { id: "1534528741775-53994a69daeb", file: "portrait-couple.jpg" },
  // food & drink
  { id: "1504674900247-0877df9cc836", file: "food.jpg" },
  { id: "1495474472287-4d71bcdd2085", file: "coffee.jpg" },
  { id: "1546069901-ba9599a7e63c", file: "bowl-food.jpg" },
  { id: "1498837167922-ddd27525d352", file: "breakfast.jpg" },
  { id: "1508739773434-c26b3d09e071", file: "pasta.jpg" },
  // nature & wildlife
  { id: "1504280390367-361c6d9f38f4", file: "campfire.jpg" },
  { id: "1518495973542-4542c06a5843", file: "snowy-peaks.jpg" },
  { id: "1466692476868-aef1dfb1e735", file: "sunset-sky.jpg" },
  { id: "1518531933037-91b2f5f229cc", file: "deer.jpg" },
  { id: "1552053831-71594a27632d", file: "dog-wild.jpg" },
  { id: "1509316785289-025f5b846b35", file: "woodland.jpg" },
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
