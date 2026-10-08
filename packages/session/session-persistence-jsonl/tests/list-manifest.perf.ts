/**
 * A/B measurements for the per-project list manifest: warm list() calls hit
 * the manifest (two stats per session), cold calls rebuild from directory
 * scans and header reads after the manifest is deleted. The corpus uses the
 * production default `zstd` encoding. Run via tsx:
 *
 *   tsx tests/list-manifest.perf.ts write [root]  # materialize SESSIONS one-turn logs
 *   tsx tests/list-manifest.perf.ts list [root]   # warm vs cold list() medians
 */

import { Context } from '@deepseek-ai/cordis'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MANIFEST_BASENAME } from '../src/list-manifest.ts'
import { projectDir } from '../src/format.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const SESSIONS = 100
const SAMPLES = 15

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const timed = async (operation: () => Promise<unknown>): Promise<number> => {
  const start = performance.now()
  await operation()
  return performance.now() - start
}

function header(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_000, isSeeded: false }
}

function oneTurnLog(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: SessionSeq(1), time: 2, data: {
      id: MessageId('user-1'), role: 'user',
      content: [{ type: 'text', text: 'list-manifest perf fixture turn' }], source: { kind: 'user' },
    }, surfaceOp: 'append' },
    { type: 'turn/end', seq: SessionSeq(2), time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

async function withPersistence(root: string, run: (persistence: SessionPersistence) => Promise<void>): Promise<void> {
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
    await run(ctx.sessionPersistence)
  } finally {
    await ctx.fiber.dispose()
  }
}

async function writeMode(root: string): Promise<void> {
  await withPersistence(root, async (persistence) => {
    for (let index = 0; index < SESSIONS; index++) {
      const handle = await persistence.create(header(`perf-list-${index}`))
      try {
        await handle.append(oneTurnLog())
        await handle.flush()
      } finally {
        await handle.close()
      }
    }
  })
  console.log(`wrote ${SESSIONS} one-turn sessions under ${root}`)
}

async function listMode(root: string): Promise<void> {
  const warm: number[] = []
  const cold: number[] = []
  await withPersistence(root, async (persistence) => {
    // Interleave arms with a per-sample cold reset so ambient load hits both
    // equally; a cold list republishes the manifest, so delete it every time.
    for (let sample = 0; sample < SAMPLES; sample++) {
      warm.push(await timed(() => persistence.list()))
      await rm(join(projectDir(root, undefined), MANIFEST_BASENAME))
      cold.push(await timed(() => persistence.list()))
    }
  })
  const warmMedian = median(warm)
  const coldMedian = median(cold)
  console.log(`sessions=${SESSIONS} samples=${SAMPLES}`)
  console.log(`warm (manifest hit)  median: ${warmMedian.toFixed(2)} ms  (${warm.map(v => v.toFixed(1)).join(', ')})`)
  console.log(`cold (rebuild)       median: ${coldMedian.toFixed(2)} ms  (${cold.map(v => v.toFixed(1)).join(', ')})`)
  console.log(`speedup: ${(coldMedian / warmMedian).toFixed(1)}x`)
}

const mode = process.argv[2] ?? 'list'
/** Persist the corpus across invocations: pass an explicit root as argv[3] (the list mode reuses it). */
const root = process.argv[3] ?? await mkdtemp(join(tmpdir(), 'dsh-list-manifest-perf-'))
try {
  if (mode === 'write') await writeMode(root)
  else await listMode(root)
} finally {
  if (process.argv[3] === undefined) await rm(root, { recursive: true, force: true })
}
