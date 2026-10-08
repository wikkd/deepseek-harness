/** Worker entry for current-generation verification and isolated Zstandard decode. */

import { parentPort, workerData } from 'node:worker_threads'
import { verifyJsonlCurrentGeneration } from './generation.ts'
import type { JsonlExpectedPrefix } from './generation.ts'
import type { JsonlCompression } from './format.ts'
import { scanZstdFrames, createZstdFrameDecoder, decompressZstdPrefix } from './zstd.ts'
import type { ZstdFrameRange } from './zstd.ts'
import type { ZstdDecodeRequest, ZstdDecodePayload } from './zstd-decode-isolate.ts'

interface VerificationRequest {
  readonly path: string
  readonly compression: JsonlCompression
  readonly expectedId: string
  readonly expectedEventCount: number
  readonly expectedPrefix?: JsonlExpectedPrefix
}

function parseRequest(value: unknown): VerificationRequest {
  if (typeof value !== 'object' || value === null) throw new Error('migration verifier request must be an object')
  const request = value as Partial<VerificationRequest>
  if (typeof request.path !== 'string'
    || request.compression !== 'none' && request.compression !== 'zstd'
    || typeof request.expectedId !== 'string'
    || !Number.isSafeInteger(request.expectedEventCount)
    || (request.expectedEventCount as number) < 0
    || request.expectedPrefix !== undefined
      && (!Number.isSafeInteger(request.expectedPrefix.bytes)
        || request.expectedPrefix.bytes < 0
        || !/^[0-9a-f]{64}$/.test(request.expectedPrefix.digest))) {
    throw new Error('migration verifier request is malformed')
  }
  return request as VerificationRequest
}

if (parentPort === null) throw new Error('isolated task worker requires a parent port')
const port = parentPort

/** Locally decoded plaintext still held in worker-side buffers. */
interface LocalZstdDecode {
  readonly frames: ZstdFrameRange[]
  readonly tornStart?: number
  readonly plaintexts: Buffer[]
  readonly tornPlaintext?: Buffer
}

/**
 * Decode every structurally complete frame plus any recoverable torn-frame
 * prefix. Plaintexts are copied to exact-size buffers so each underlying
 * ArrayBuffer can transfer back to the parent without sharing.
 */
async function decodeZstd(request: ZstdDecodeRequest): Promise<LocalZstdDecode> {
  const source = Buffer.from(request.source.buffer, request.source.byteOffset, request.source.byteLength)
  const { frames, tornStart } = scanZstdFrames(source)
  if (frames.length === 0) throw new Error('empty or header-less Zstandard session log')
  const decoder = createZstdFrameDecoder()
  const plaintexts: Buffer[] = []
  try {
    for (const frame of decoder.decode(source, frames)) {
      // The shared decoder reuses one output buffer; views must be copied
      // before the next frame overwrites them.
      plaintexts.push(Buffer.from(frame))
    }
  } finally {
    decoder.close()
  }
  let tornPlaintext: Buffer | undefined
  if (tornStart !== undefined) {
    try {
      tornPlaintext = await decompressZstdPrefix(source.subarray(tornStart))
    } catch {
      // A structurally incomplete final frame may end before the decoder can
      // emit any plaintext; the complete prior frames remain recoverable.
    }
  }
  return {
    frames,
    ...(tornStart === undefined ? {} : { tornStart }),
    plaintexts,
    ...(tornPlaintext === undefined ? {} : { tornPlaintext }),
  }
}

/** Decode mode serves postMessage requests for the process lifetime. */
function serveZstdDecode(): void {
  port.on('message', (request: unknown) => {
    void handleDecodeRequest(request)
  })
}

async function handleDecodeRequest(request: unknown): Promise<void> {
  if (typeof request !== 'object' || request === null
    || (request as { id?: unknown }).id === undefined
    || (request as { kind?: unknown }).kind !== 'zstd-decode') {
    return
  }
  const { id } = request as { id: number }
  try {
    const payload = await decodeZstd(request as ZstdDecodeRequest)
    // Small pooled buffers share one ArrayBuffer; copying into fresh
    // ArrayBuffers detaches each view so every entry can transfer.
    const standalone = (view: Buffer): Uint8Array<ArrayBuffer> => {
      const copy = new ArrayBuffer(view.byteLength)
      new Uint8Array(copy).set(view)
      return new Uint8Array(copy)
    }
    const plaintexts = payload.plaintexts.map(standalone)
    const tornPlaintext = payload.tornPlaintext === undefined ? undefined : standalone(payload.tornPlaintext)
    const transferable: ArrayBuffer[] = plaintexts.map(view => view.buffer)
    if (tornPlaintext !== undefined) transferable.push(tornPlaintext.buffer)
    const response: ZstdDecodePayload = {
      frames: payload.frames,
      ...(payload.tornStart === undefined ? {} : { tornStart: payload.tornStart }),
      plaintexts,
      ...(tornPlaintext === undefined ? {} : { tornPlaintext }),
    }
    port.postMessage({ id, ok: true, payload: response }, transferable)
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    port.postMessage({ id, ok: false, message: failure.message, stack: failure.stack })
  }
}

async function run(): Promise<void> {
  const kind = (workerData as { kind?: unknown } | null | undefined)?.kind
  if (kind === 'zstd-decode') {
    serveZstdDecode()
    return
  }
  const request = parseRequest(workerData)
  try {
    const result = await verifyJsonlCurrentGeneration(
      request.path,
      request.compression,
      request.expectedId,
      request.expectedEventCount,
      request.expectedPrefix,
    )
    port.postMessage({ ok: true, payload: result })
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    port.postMessage({ ok: false, message: failure.message, stack: failure.stack })
  } finally {
    port.close()
  }
}

void run()
