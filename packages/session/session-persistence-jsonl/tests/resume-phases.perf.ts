/**
 * Phase breakdown for one cold session-log decode: file IO → zstd decode →
 * line/JSON scan → event validation → deep freeze. Run:
 *
 *   tsx tests/resume-phases.perf.ts <root>
 */

import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { readStableJsonlFile } from '../src/generation.ts'
import { SessionLogScanner, logPath } from '../src/format.ts'
import { createZstdFrameDecoder, scanZstdFrames } from '../src/zstd.ts'
import { performance } from 'node:perf_hooks'

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const freezeAll = (events: SessionEvent[]): void => {
  const pending: object[] = []
  for (const event of events) pending.push(event)
  while (pending.length > 0) {
    const current = pending.pop()!
    Object.freeze(current)
    if (Array.isArray(current)) {
      for (const child of current) if (child !== null && typeof child === 'object') pending.push(child)
    } else {
      for (const key in current) {
        const child = (current as Record<string, unknown>)[key]
        if (child !== null && typeof child === 'object') pending.push(child)
      }
    }
  }
}

const root = process.argv[2]
if (root === undefined) throw new Error('usage: tsx tests/resume-phases.perf.ts <root>')
const path = logPath(root, undefined, SessionId('perf-session-0'), 'zstd')

const stages: Record<string, number[]> = { io: [], zstd: [], scan: [], validate: [], freeze: [] }
const pushStage = (name: string, value: number): void => {
  const list = stages[name]
  if (list === undefined) throw new Error(`unknown stage ${name}`)
  list.push(value)
}
const RUNS = 5
let eventCount = 0
for (let run = 0; run < RUNS; run++) {
  let start = performance.now()
  const { bytes } = await readStableJsonlFile(path)
  pushStage('io', performance.now() - start)

  start = performance.now()
  // Pure zstd decode: all frames, no JSON parsing.
  const { frames } = scanZstdFrames(bytes)
  const decoder = createZstdFrameDecoder()
  const decodedFrames = decoder.decode(bytes, frames)
  const headerFrame = decodedFrames.next()
  if (headerFrame.done) throw new Error('empty log')
  // The decoder reuses one output buffer across frames, so collected frames
  // must be copied before the next frame overwrites them.
  const plaintextFrames: Buffer[] = [Buffer.from(headerFrame.value)]
  for (const plaintextFrame of decodedFrames) plaintextFrames.push(Buffer.from(plaintextFrame))
  pushStage('zstd', performance.now() - start)

  start = performance.now()
  // Pure JSON/line scan: feed the collected plaintext through the scanner.
  // The scanner constructor wants exactly one newline-terminated header
  // record, so split the first frame at its first newline.
  const firstFrame = plaintextFrames[0]!
  const headerEnd = firstFrame.indexOf(0x0A)
  if (headerEnd === -1) throw new Error('first frame has no newline')
  const scanner = new SessionLogScanner(firstFrame.subarray(0, headerEnd + 1))
  if (headerEnd + 1 < firstFrame.length) scanner.write(firstFrame.subarray(headerEnd + 1))
  for (let index = 1; index < plaintextFrames.length; index++) scanner.write(plaintextFrames[index]!)
  const scanned = scanner.finish()
  pushStage('scan', performance.now() - start)

  start = performance.now()
  const validated = validateStoredEvents(scanned.meta, scanned.events)
  pushStage('validate', performance.now() - start)

  start = performance.now()
  freezeAll(validated)
  pushStage('freeze', performance.now() - start)
  eventCount = validated.length
}

console.log(`events=${eventCount} runs=${RUNS}`)
for (const [name, values] of Object.entries(stages)) {
  console.log(`${name.padEnd(8)} median ${median(values).toFixed(1).padStart(7)} ms`)
}
