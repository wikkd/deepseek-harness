/** Main-side resident isolate for Zstandard frame decode tasks. */

import { Worker } from 'node:worker_threads'
import type { ZstdFrameRange } from './zstd.ts'
import { workerSpawn } from './migration-verifier.ts'

/** Request for one isolated multi-frame Zstandard decode. */
export interface ZstdDecodeRequest {
  readonly id: number
  readonly kind: 'zstd-decode'
  /** Concatenated Zstandard frame bytes currently present in the artifact. */
  readonly source: Uint8Array
}

/**
 * Decoded plaintext delivered back from the isolate. Plaintext buffers arrive
 * as transferred exact-size arrays; frame ranges mirror the source scan.
 */
export interface ZstdDecodePayload {
  readonly frames: ZstdFrameRange[]
  readonly tornStart?: number
  /** One plaintext per complete frame, in source order. */
  readonly plaintexts: Uint8Array[]
  readonly tornPlaintext?: Uint8Array
}

function isFrameRanges(value: unknown): value is ZstdFrameRange[] {
  return Array.isArray(value) && value.every(entry => (
    typeof entry === 'object' && entry !== null
    && typeof (entry as { start?: unknown }).start === 'number'
    && typeof (entry as { end?: unknown }).end === 'number'
  ))
}

/** Whether an answered payload has the expected physical shape; malformed answers count as isolate failures. */
function isDecodePayload(value: unknown): value is ZstdDecodePayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<ZstdDecodePayload>
  if (!isFrameRanges(payload.frames) || !Array.isArray(payload.plaintexts)) return false
  if (payload.plaintexts.some(view => !(view instanceof Uint8Array))) return false
  if (payload.tornStart !== undefined && typeof payload.tornStart !== 'number') return false
  if (payload.tornPlaintext !== undefined && !(payload.tornPlaintext instanceof Uint8Array)) return false
  return true
}

/**
 * Outcome of one isolated decode attempt. `refused` carries the task's own
 * answer (the artifact failed physical validation and must propagate);
 * `failed` means the isolate never delivered a trustworthy answer and the
 * caller may fall back to local decoding.
 */
export type ZstdDecodeOutcome =
  | { readonly kind: 'decoded'; readonly payload: ZstdDecodePayload }
  | { readonly kind: 'refused'; readonly error: Error }
  | { readonly kind: 'failed'; readonly error: Error }

interface PendingRequest {
  resolve: (outcome: ZstdDecodeOutcome) => void
}

/**
 * One long-lived decode isolate. The worker is spawned on first use and kept
 * for the process lifetime, so cold opens never pay per-open Worker startup;
 * a crashed or failed isolate respawns lazily on the next request, and any
 * request its isolate never answers reports as `failed` so callers fall back
 * to local decoding.
 */
class ZstdDecodeHost {
  private worker: Worker | undefined
  private broken = false
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()

  decode(source: Buffer, signal?: AbortSignal): Promise<ZstdDecodeOutcome> {
    if (this.broken) {
      return Promise.resolve({ kind: 'failed', error: new Error('Zstandard decode isolate is unavailable') })
    }
    try {
      this.ensureWorker()
    } catch (error: unknown) {
      this.broken = true
      return Promise.resolve({
        kind: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
    const worker = this.worker
    /* v8 ignore next -- ensureWorker either assigns the field or throws. */
    if (worker === undefined) {
      this.broken = true
      return Promise.resolve({ kind: 'failed', error: new Error('Zstandard decode isolate is unavailable') })
    }
    const id = this.nextId
    this.nextId += 1
    const request: ZstdDecodeRequest = { id, kind: 'zstd-decode', source }
    // The input is cloned, not transferred: an isolate failure must leave the
    // local bytes intact for the main-thread decode fallback.
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ kind: 'failed', error: new Error('Zstandard decode isolate cancelled') })
        return
      }
      this.pending.set(id, { resolve })
      const abort = (): void => {
        this.pending.delete(id)
        resolve({ kind: 'failed', error: new Error('Zstandard decode isolate cancelled') })
      }
      signal?.addEventListener('abort', abort, { once: true })
      worker.postMessage(request)
    })
  }

  private ensureWorker(): void {
    if (this.worker !== undefined) return
    const { entry, options } = workerSpawn({ kind: 'zstd-decode' })
    const worker = new Worker(entry, options)
    worker.unref()
    worker.on('message', (value: unknown) => {
      if (typeof value !== 'object' || value === null || typeof (value as { id?: unknown }).id !== 'number') return
      const envelope = value as { id: number; ok?: unknown; payload?: unknown; message?: unknown; stack?: unknown }
      const pending = this.pending.get(envelope.id)
      if (pending === undefined) return
      this.pending.delete(envelope.id)
      if (envelope.ok === true && isDecodePayload(envelope.payload)) {
        pending.resolve({ kind: 'decoded', payload: envelope.payload })
        return
      }
      if (envelope.ok === false) {
        const error = new Error(typeof envelope.message === 'string' ? envelope.message : 'isolated Zstandard decode reported a failure')
        if (typeof envelope.stack === 'string') error.stack = envelope.stack
        pending.resolve({ kind: 'refused', error })
        return
      }
      pending.resolve({ kind: 'failed', error: new Error('isolated Zstandard decode returned an invalid payload') })
    })
    worker.on('error', () => {
      this.isolateDied(worker)
    })
    worker.on('exit', () => {
      this.isolateDied(worker)
    })
    this.worker = worker
  }

  /** Fail every unanswered request and drop the isolate; the next request respawns. */
  private isolateDied(worker: Worker): void {
    if (this.worker !== worker) return
    this.worker = undefined
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) {
      request.resolve({ kind: 'failed', error: new Error('Zstandard decode isolate exited before answering') })
    }
  }
}

const decodeHost = new ZstdDecodeHost()

/**
 * Decode one artifact's Zstandard frames in the resident decode isolate so
 * native decompression never blocks the main thread.
 * @param source - concatenated Zstandard frame bytes currently present in the artifact.
 * @param signal - optional cancellation for the waiting caller.
 * @returns the decoded plaintext payload, the task's own refusal, or an
 * isolate failure the caller may fall back from.
 */
export async function decodeZstdFramesInWorker(
  source: Buffer,
  signal?: AbortSignal,
): Promise<ZstdDecodeOutcome> {
  return decodeHost.decode(source, signal)
}
