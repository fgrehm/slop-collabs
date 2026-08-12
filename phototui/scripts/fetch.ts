#!/usr/bin/env bun

/**
 * Downloads a curated set of Pexels photos into ./cache (gitignored).
 * No API key needed: images.pexels.com serves photos by ID directly.
 * Pexels photos are free to use for personal and commercial projects;
 * attribution is appreciated but not required.
 *
 * The viewer only ever reads a directory of image files from disk, so
 * swapping this source out later (local folder, real API) is a no-op there.
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// Curated via scripts/_scrape-pexels.ts + scripts/_pick-pexels.ts (one-off
// build tools, not runtime deps). A balanced mix of subjects and orientations.
const PHOTOS = [
  { id: "16684688", file: "portrait-01.jpg", alt: "Studio portrait of an adult man wearing a jacket" },
  { id: "28853195", file: "flowers-01.jpg", alt: "Vivid red Dianthus flowers with green foliage" },
  { id: "4972790", file: "portrait-02.jpg", alt: "Smiling woman with long hair on a sunny day" },
  { id: "10812818", file: "wildlife-01.jpg", alt: "Two blackbucks stand gracefully in Chitradurga" },
  { id: "29422607", file: "city-01.jpg", alt: "Night view of Toronto cityscape" },
  { id: "4252525", file: "abstract-01.jpg", alt: "Minimalistic abstract composition with layered shapes" },
  { id: "18893527", file: "architecture-01.jpg", alt: "Low angle shot of a dramatic modern facade" },
  { id: "23644633", file: "food-01.jpg", alt: "A gourmet dish elegantly plated" },
  { id: "17702304", file: "travel-01.jpg", alt: "A serene drive on a mountain highway" },
  { id: "36060523", file: "forest-01.jpg", alt: "A serene path through a lush green forest" },
  { id: "1005255", file: "landscape-01.jpg", alt: "Rolling hills and lush valleys under a blue sky" },
  { id: "36952051", file: "ocean-01.jpg", alt: "Powerful waves crashing in the sea with a cloudy sky" },
  { id: "10500054", file: "portrait-03.jpg", alt: "Side view portrait of a bearded man in dark tones" },
  { id: "38509728", file: "flowers-02.jpg", alt: "Yellow, orange, and pink zinnias blooming" },
  { id: "10688981", file: "portrait-04.jpg", alt: "Black and white portrait of a smiling woman" },
  { id: "35652350", file: "wildlife-02.jpg", alt: "A spotted deer grazes in the lush forests" },
  { id: "15480506", file: "city-02.jpg", alt: "Night view of Singapore's illuminated skyline" },
  { id: "13807430", file: "abstract-02.jpg", alt: "Dynamic abstract digital art with flowing geometry" },
  { id: "15434035", file: "architecture-02.jpg", alt: "Red tile roof seen through a large window" },
  { id: "27972413", file: "food-02.jpg", alt: "Elegant chocolate dessert garnished with a flower" },
  { id: "8975329", file: "travel-02.jpg", alt: "Aerial shot of a winding road through foggy mountains" },
  { id: "7689028", file: "forest-02.jpg", alt: "Aerial view of a dense forest" },
  { id: "10176701", file: "landscape-02.jpg", alt: "Mountains under golden sunlight from above" },
  { id: "31995194", file: "ocean-02.jpg", alt: "Vibrant ocean waves showing dynamic movement" },
  { id: "38215386", file: "portrait-05.jpg", alt: "Moody black and white portrait of a man outdoors" },
  { id: "36812083", file: "people-01.jpg", alt: "Two gardeners tending plants in a greenhouse" },
  { id: "3791554", file: "portrait-06.jpg", alt: "Portrait of a smiling woman with brunette hair" },
  { id: "16840106", file: "wildlife-03.jpg", alt: "A spotted deer and a white cow resting outdoors" },
  { id: "30373052", file: "city-03.jpg", alt: "Illuminated skyscrapers reflected on the water" },
  { id: "11991914", file: "architecture-03.jpg", alt: "Minimalist architectural structure with white walls" },
  { id: "13207532", file: "architecture-04.jpg", alt: "Low angle view of a modern geometric building" },
  { id: "5966432", file: "food-03.jpg", alt: "Colorful assortment of healthy foods on a plate" },
  { id: "12639194", file: "travel-03.jpg", alt: "View of an open highway from inside a vehicle" },
  { id: "15846387", file: "forest-03.jpg", alt: "Forest with tall moss-covered tree trunks" },
  { id: "13172740", file: "landscape-03.jpg", alt: "Mountain range at golden hour" },
  { id: "38414180", file: "ocean-03.jpg", alt: "Deep blue ocean with intricate patterns" },
  { id: "38773573", file: "portrait-07.jpg", alt: "Stylish man with sunglasses poses outdoors" },
  { id: "31215699", file: "flowers-03.jpg", alt: "Close-up of vibrant yellow marigolds" },
  { id: "11054025", file: "portrait-08.jpg", alt: "Portrait of a smiling woman with red hair" },
  { id: "5649002", file: "wildlife-04.jpg", alt: "A spotted hyena standing in a zoo setting" },
  { id: "10696099", file: "city-04.jpg", alt: "Brisbane's illuminated skyline" },
  { id: "4252663", file: "abstract-03.jpg", alt: "Minimalist abstract design with zigzag patterns" },
  { id: "16615613", file: "architecture-05.jpg", alt: "Clean minimalist architectural facade" },
  { id: "18446100", file: "food-04.jpg", alt: "Gourmet dish with roasted vegetables and meat" },
  { id: "4618591", file: "travel-04.jpg", alt: "A jeep travels down a winding rural road" },
  { id: "3655865", file: "forest-04.jpg", alt: "Aerial view of dense evergreen forest in Germany" },
  { id: "34198832", file: "landscape-04.jpg", alt: "Serene beauty of the Carpathian Mountains" },
  { id: "29082642", file: "ocean-04.jpg", alt: "Dynamic ocean waves under a bright blue sky" },
]

const CACHE_DIR = resolve(import.meta.dir, "..", "cache")
const WIDTH = "900"

async function fetchPhoto(id: string, file: string): Promise<boolean> {
  const dest = join(CACHE_DIR, file)
  if (existsSync(dest)) {
    console.log(`skip   ${file} (already present)`)
    return true
  }
  // Pexels CDN serves by ID directly, no key. `?w=` downscales server-side.
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${WIDTH}`
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } })
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
