/**
 * Threshold-free resume-load measurements for the JSONL backend: build
 * realistic multi-thousand-turn logs, then measure cold full reads and
 * tail-slice reads. Run via tsx with a mode argument:
 *
 *   tsx tests/resume-load.perf.ts write         # materialize SESSIONS session logs
 *   tsx tests/resume-load.perf.ts full  [root]  # cold full reads (median of SESSIONS)
 *   tsx tests/resume-load.perf.ts tail  [root]  # cold tail-slice reads (resume-style)
 *   tsx tests/resume-load.perf.ts window [root] # frame-index tail reads vs full-decode equivalence
 */

import { Context } from '@deepseek-ai/cordis'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logPath } from '../src/format.ts'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const SESSIONS = 3
const TURNS = 3_000
const TAIL_EVENTS = 30

const USER_TEXT = '帮我看看这段代码为什么会崩溃，栈指向了一个空指针，另外把修复补丁也一并给出。'.repeat(2)

/** Per-turn unique assistant text: real logs never repeat content, so zstd ratio stays realistic. */
function assistantText(turn: number): string {
  const lines: string[] = []
  for (let line = 0; line < 24; line++) {
    lines.push(`分析结论 ${turn}-${line}：解引用前缺少空值守卫 guard-check-${turn}-${line}，` +
      `循环边界 boundary-${turn}-${line} 同样会触发越界路径，回归测试 case-${turn}-${line} 覆盖该分支，` +
      `参考 offset ${turn * 1000 + line} 与 checksum ${(turn * 7919 + line * 104729) % 99991}。`)
  }
  return lines.join('\n')
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const timed = async (operation: () => Promise<unknown>): Promise<number> => {
  const start = performance.now()
  await operation()
  return performance.now() - start
}

function turnEvents(turn: number, seqBase: number): SessionEvent[] {
  let seq = seqBase
  const next = (): number => seq++
  const time = 1_700_000_000_000 + turn * 1000
  const userMessage = {
    id: MessageId(`user-${turn}`), role: 'user' as const,
    content: [{ type: 'text' as const, text: USER_TEXT }], source: { kind: 'user' as const },
  }
  const assistantTextTurn = assistantText(turn)
  const assistantMessage = {
    id: MessageId(`assistant-${turn}`), role: 'assistant' as const,
    content: [{ type: 'text' as const, text: assistantTextTurn }],
    source: { kind: 'model' as const, provider: 'mock', model: 'mock' },
  }
  return [
    { type: 'turn/start', seq: SessionSeq(next()), time, data: { turn } },
    { type: 'user/message', seq: SessionSeq(next()), time, data: userMessage, surfaceOp: 'append' },
    { type: 'step/start', seq: SessionSeq(next()), time, data: { turn, step: 1 } },
    { type: 'assistant/message', seq: SessionSeq(next()), time, data: {
      turn, step: 1,
      message: assistantMessage,
      stream: [
        { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'text-chunks', time0: time, index: 0, dt: [], texts: [assistantTextTurn] },
        { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: assistantTextTurn } } },
        { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
      ],
    }, surfaceOp: 'append' },
    { type: 'step/end', seq: SessionSeq(next()), time, data: { turn, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(next()), time, data: { turn, reason: { kind: 'completed' } } },
  ]
}

function header(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_000, isSeeded: false }
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
      const id = `perf-session-${index}`
      const m = header(id)
      const handle = await persistence.create(m)
      let seq = 0
      const writeStart = performance.now()
      try {
        for (let turn = 1; turn <= TURNS; turn++) {
          const events = turnEvents(turn, seq)
          seq += events.length
          await handle.append(events)
        }
        await handle.flush()
      } finally {
        await handle.close()
      }
      const bytes = (await stat(logPath(root, m.cwd, m.id, 'zstd'))).size
      console.log(`wrote ${id}: ${TURNS} turns, ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${(performance.now() - writeStart) / 1000 | 0}s`)
    }
  })
}

async function readMode(root: string, kind: 'full' | 'tail'): Promise<void> {
  const coldReads: number[] = []
  let eventCount = 0
  await withPersistence(root, async (persistence) => {
    for (let index = 0; index < SESSIONS; index++) {
      const id = SessionId(`perf-session-${index}`)
      // One read per session per process keeps the 2-entry memo cold every time.
      coldReads.push(await timed(async () => {
        const handle = await persistence.open(id, 'read')
        try {
          if (kind === 'full') {
            const result = await handle.read()
            eventCount = result.events.length
          } else {
            const full = await handle.read()
            const result = await handle.read(full.events.length - TAIL_EVENTS, TAIL_EVENTS)
            if (result.events.length !== TAIL_EVENTS) throw new Error(`tail read got ${result.events.length}`)
            eventCount = full.events.length
          }
        } finally {
          await handle.close()
        }
      }))
    }
  })
  const bytes = (await stat(logPath(root, undefined, SessionId('perf-session-0'), 'zstd'))).size
  console.log(`mode=${kind} events=${eventCount} size=${(bytes / 1024 / 1024).toFixed(2)} MiB samples=${SESSIONS}`)
  console.log(`${kind === 'full' ? 'cold full read' : 'cold tail+full read'} median: ${median(coldReads).toFixed(0)} ms  (${coldReads.map(v => v.toFixed(0)).join(', ')})`)
}

/**
 * Frame-index window reads over long-lived handles — the shape the real tail
 * consumers use (a session stays open while its tail is re-read). Warm-up
 * opens decode each log once, building the frame indexes and leaving only the
 * last two sessions in the whole-log memo; session 0 therefore misses the
 * memo on every round and takes the frame-index fast path while sessions 1-2
 * hit the memo. Every window result must equal the full-decode slice.
 */
async function windowMode(root: string): Promise<void> {
  const ROUNDS = 5
  const expected: SessionEvent[][] = []
  const totals: number[] = []
  await withPersistence(root, async (persistence) => {
    const handles: Awaited<ReturnType<SessionPersistence['open']>>[] = []
    try {
      for (let index = 0; index < SESSIONS; index++) {
        const id = SessionId(`perf-session-${index}`)
        const handle = await persistence.open(id, 'read')
        handles.push(handle)
        const full = await handle.read()
        totals.push(full.events.length)
        expected.push(full.events.slice(full.events.length - TAIL_EVENTS))
      }

      const indexPath: number[] = []
      const memoPath: number[] = []
      for (let round = 0; round < ROUNDS; round++) {
        for (let index = 0; index < SESSIONS; index++) {
          const ms = await timed(async () => {
            const result = await handles[index]!.read(totals[index]! - TAIL_EVENTS, TAIL_EVENTS)
            if (result.events.length !== TAIL_EVENTS) throw new Error(`window read got ${result.events.length}`)
            if (JSON.stringify(result.events) !== JSON.stringify(expected[index]!)) {
              throw new Error(`window slice disagrees with the full decode for session ${index}`)
            }
          })
          if (index === 0) indexPath.push(ms)
          else memoPath.push(ms)
        }
      }
      const bytes = (await stat(logPath(root, undefined, SessionId('perf-session-0'), 'zstd'))).size
      console.log(`mode=window events=${totals[0]} size=${(bytes / 1024 / 1024).toFixed(2)} MiB rounds=${ROUNDS} tail=${TAIL_EVENTS} events`)
      console.log(`frame-index tail read median: ${median(indexPath).toFixed(2)} ms  (${indexPath.map(v => v.toFixed(2)).join(', ')})`)
      console.log(`memo-hit tail read median:    ${median(memoPath).toFixed(2)} ms  (${memoPath.map(v => v.toFixed(2)).join(', ')})`)
    } finally {
      for (const handle of handles) await handle.close()
    }
  })
}

const mode = process.argv[2] ?? 'full'
/** Persist the corpus across invocations: pass an explicit root as argv[3] (read modes reuse it). */
const root = process.argv[3] ?? await mkdtemp(join(tmpdir(), 'dsh-resume-perf-'))
try {
  if (mode === 'write') await writeMode(root)
  else if (mode === 'window') await windowMode(root)
  else await readMode(root, mode === 'tail' ? 'tail' : 'full')
} finally {
  if (process.argv[3] === undefined) await rm(root, { recursive: true, force: true })
}
