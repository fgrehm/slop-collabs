// A small pool of decode workers. Decoding a JPEG/PNG is a synchronous,
// CPU-bound native call; offloading it to worker threads keeps the main
// render loop responsive for large galleries.
//
//   const pool = new DecodePool(4)
//   const handle = pool.decode(path, ({ rgba, width, height, stride }) => {
//     // called on the main thread when the worker returns
//   })
//   handle.cancel()  // ignore a still-pending decode (e.g. cell scrolled away)

import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface DecodedImage {
  rgba: Uint8Array
  width: number
  height: number
  stride: number
}

export interface DecodeHandle {
  cancel: () => void
}

export class DecodePool {
  private workers: Worker[]
  private next: number[] = [] // round-robin cursor kept simple via a counter
  private counter = 0
  private pending: Map<number, (img: DecodedImage | null) => void> = new Map()

  constructor(size: number) {
    this.workers = []
    for (let i = 0; i < size; i++) {
      const w = new Worker(join(__dirname, "decode-worker.ts"))
      w.on("message", (msg: { id: number; rgba: Uint8Array; width: number; height: number; stride: number; error?: string }) => {
        const resolve = this.pending.get(msg.id)
        if (!resolve) return // cancelled or stale
        this.pending.delete(msg.id)
        if (msg.error || msg.width === 0) resolve(null)
        else resolve({ rgba: msg.rgba, width: msg.width, height: msg.height, stride: msg.stride })
      })
      w.on("error", (err: unknown) => {
        // A worker crashed; fail every pending request on it. For a POC we
        // just log; the affected cells stay empty until they re-enter view.
        console.error("decode worker error:", err instanceof Error ? err.message : String(err))
      })
      this.workers.push(w)
    }
  }

  decode(path: string, onDone: (img: DecodedImage | null) => void): DecodeHandle {
    const id = this.counter++
    this.pending.set(id, onDone)
    const worker = this.workers[id % this.workers.length]!
    worker.postMessage({ id, path })
    return {
      cancel: () => {
        // The worker still runs to completion; we just drop the result.
        this.pending.delete(id)
      },
    }
  }

  destroy() {
    for (const w of this.workers) void w.terminate()
    this.workers = []
    this.pending.clear()
  }
}