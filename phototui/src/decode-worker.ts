// Worker that decodes one image file to RGBA off the main thread, so the
// synchronous OpenTUI `imageDecode` FFI no longer stalls the render loop.
// Runs in a node:worker_threads Worker; requires @opentui/core, which means
// the worker gets its own instance of the native Zig lib (verified to work).
//
// Real albums are full-resolution (12MP+), and decoding those fully is
// expensive. To avoid re-decoding them on every visit, the worker keeps a
// thumbnail cache on disk: the first time a photo is seen it is decoded and
// downscaled to a fixed 256px thumbnail (stored as raw RGBA with a small
// header); later visits read the tiny thumbnail file instead of the original.

import { parentPort } from "node:worker_threads"
import { NativeImage } from "@opentui/core"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const THUMB_SIZE = 256 // long edge, pixels
const THUMB_HEADER = "PTRGBA" // magic + u32 width + u32 height + u32 stride

function thumbDir(): string {
  // /tmp for now: this is a POC, not production-ready. A real cache would
  // live under XDG_CACHE_HOME and be invalidated when the source changes.
  return join("/tmp", "phototui-thumbs")
}

function thumbPath(path: string): string {
  const hash = createHash("sha1").update(path).digest("hex")
  return join(thumbDir(), `${hash}.rgba`)
}

function writeThumb(path: string, img: NativeImage) {
  const { data, width, height, stride } = img.raw()
  const header = Buffer.alloc(THUMB_HEADER.length + 12)
  header.write(THUMB_HEADER, 0, "ascii")
  header.writeUInt32LE(width, THUMB_HEADER.length)
  header.writeUInt32LE(height, THUMB_HEADER.length + 4)
  header.writeUInt32LE(stride, THUMB_HEADER.length + 8)
  mkdirSync(thumbDir(), { recursive: true })
  writeFileSync(path, Buffer.concat([header, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]))
}

function readThumb(path: string): NativeImage | null {
  try {
    const file = readFileSync(path)
    if (file.length < THUMB_HEADER.length + 12 || file.subarray(0, THUMB_HEADER.length).toString("ascii") !== THUMB_HEADER) {
      return null
    }
    const width = file.readUInt32LE(THUMB_HEADER.length)
    const height = file.readUInt32LE(THUMB_HEADER.length + 4)
    const stride = file.readUInt32LE(THUMB_HEADER.length + 8)
    const rgba = new Uint8Array(file.buffer, file.byteOffset + THUMB_HEADER.length + 12, file.byteLength - THUMB_HEADER.length - 12)
    return NativeImage.fromRgba(rgba, width, height, stride)
  } catch {
    return null
  }
}

function coverResize(img: NativeImage, targetW: number, targetH: number): NativeImage {
  if (targetW <= 0 || targetH <= 0) return img
  const scale = Math.max(targetW / img.width, targetH / img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const resized = img.resize({ width: w, height: h })
  img.dispose()
  return resized
}

interface DecodeRequest {
  id: number
  path: string
  targetW: number // 0 = no downscale, send full-resolution RGBA
  targetH: number
}

interface DecodeResult {
  id: number
  path: string
  width: number
  height: number
  stride: number
  rgba: Uint8Array
  error?: string
}

parentPort?.on("message", (req: DecodeRequest) => {
  try {
    const tp = thumbPath(req.path)
    let img = readThumb(tp)
    if (!img) {
      // First visit: decode the full-resolution original, downscale to the
      // fixed thumbnail size, and persist it so later visits are cheap.
      const bytes = readFileSync(req.path)
      const full = NativeImage.decode(bytes)
      const scale = Math.min(1, THUMB_SIZE / Math.max(full.width, full.height))
      const tw = Math.max(1, Math.round(full.width * scale))
      const th = Math.max(1, Math.round(full.height * scale))
      const thumb = full.resize({ width: tw, height: th })
      full.dispose()
      writeThumb(tp, thumb)
      img = thumb
    }
    // Downscale the (small) thumbnail to cover the target cell pixels so the
    // main thread uploads a tiny image and the terminal receives far fewer
    // bytes per cell (the stdout write is the real frame-time cost).
    img = coverResize(img, req.targetW, req.targetH)
    const { data, width, height, stride } = img.raw()
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const out: DecodeResult = {
      id: req.id,
      path: req.path,
      width,
      height,
      stride,
      rgba: new Uint8Array(buffer),
    }
    img.dispose()
    parentPort?.postMessage(out, [buffer])
  } catch (err) {
    const out: DecodeResult = {
      id: req.id,
      path: req.path,
      width: 0,
      height: 0,
      stride: 0,
      rgba: new Uint8Array(),
      error: err instanceof Error ? err.message : String(err),
    }
    parentPort?.postMessage(out)
  }
})