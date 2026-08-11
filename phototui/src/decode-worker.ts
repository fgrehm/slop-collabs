// Worker that decodes one image file to RGBA off the main thread, so the
// synchronous OpenTUI `imageDecode` FFI no longer stalls the render loop.
// Runs in a node:worker_threads Worker; requires @opentui/core, which means
// the worker gets its own instance of the native Zig lib (verified to work).

import { parentPort } from "node:worker_threads"
import { NativeImage } from "@opentui/core"
import { readFileSync } from "node:fs"

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
    const bytes = readFileSync(req.path)
    let img = NativeImage.decode(bytes)
    // Downscale to cover the target cell pixels so the main thread uploads a
    // tiny image instead of the full-resolution one - this is what keeps the
    // stdout write small (the render path sends far fewer bytes per cell).
    if (req.targetW > 0 && req.targetH > 0) {
      const scale = Math.max(req.targetW / img.width, req.targetH / img.height)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const resized = img.resize({ width: w, height: h })
      img.dispose()
      img = resized
    }
    const { data, width, height, stride } = img.raw()
    // Transfer the underlying ArrayBuffer so the pixels cross the thread
    // boundary without a copy.
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