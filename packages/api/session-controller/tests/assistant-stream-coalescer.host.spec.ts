import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionAssistantStreamFrame } from '../src/types.ts'
import { AssistantStreamCoalescer } from '../src/assistant-stream-coalescer.ts'

const SID = SessionId('coalesce-session')

function chunkFrame(overrides: Partial<Extract<SessionAssistantStreamFrame, { type: 'chunk' }>> = {}): SessionAssistantStreamFrame {
  return {
    type: 'chunk', attemptId: LlmAttemptId('a1'), revision: 2, index: 0, time: 100,
    chunk: { type: 'text-delta', index: 0, text: 'x' },
    ...overrides,
  }
}

function startFrame(revision = 1): SessionAssistantStreamFrame {
  return { type: 'start', attemptId: LlmAttemptId('a1'), revision, startedAfterSeq: -1, turn: 1, step: 1 }
}

function endFrame(index: number): SessionAssistantStreamFrame {
  return { type: 'end', attemptId: LlmAttemptId('a1'), revision: 9, index, outcome: { kind: 'abandoned' } }
}

function framesOf(templates: readonly { raw: SessionAssistantStreamFrame }[]): SessionAssistantStreamFrame[] {
  return templates.map(template => template.raw)
}

describe('AssistantStreamCoalescer', () => {
  let seq = 0
  beforeEach(() => {
    seq = 0
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  it('merges adjacent same-index text deltas into one frame inside the window', () => {
    const distributed: Array<[SessionId, SessionAssistantStreamFrame[]]> = []
    const coalescer = new AssistantStreamCoalescer(
      (sessionId, templates) => distributed.push([sessionId, framesOf(templates)]), 33,
    )
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'b' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'c' } }), ++seq)
    expect(distributed).toEqual([])

    vi.advanceTimersByTime(33)
    expect(distributed).toEqual([[SID, [
      chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'abc' } }),
    ]]])
  })

  it('keeps separate frames across indexes, attempts, and non-mergeable boundary frames', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)

    // A different block index splits the merge run.
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ revision: 3, chunk: { type: 'text-delta', index: 1, text: 'b' } }), ++seq)
    // A different attempt never merges.
    coalescer.accept(SID, chunkFrame({ attemptId: LlmAttemptId('a2'), revision: 4, chunk: { type: 'text-delta', index: 1, text: 'c' } }), ++seq)
    vi.advanceTimersByTime(33)
    expect(seen).toEqual([
      chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      chunkFrame({ revision: 3, chunk: { type: 'text-delta', index: 1, text: 'b' } }),
      chunkFrame({ attemptId: LlmAttemptId('a2'), revision: 4, chunk: { type: 'text-delta', index: 1, text: 'c' } }),
    ])
    coalescer.dispose()
  })

  it('merges reasoning deltas and tool-call deltas under the compressor name rule', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)

    coalescer.accept(SID, chunkFrame({ chunk: { type: 'reasoning-delta', index: 0, text: 'think ' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'reasoning-delta', index: 0, text: 'more' } }), ++seq)
    coalescer.accept(SID, endFrame(1), ++seq) // boundary flushes the open reasoning window first

    coalescer.accept(SID, startFrame(), ++seq)
    coalescer.accept(SID, chunkFrame({ index: 0, chunk: { type: 'tool-call-delta', index: 0, id: 't1', name: 'run', argumentsDelta: '{"a"' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ index: 1, chunk: { type: 'tool-call-delta', index: 0, id: 't1', name: 'run', argumentsDelta: ':1}' } }), ++seq)
    // Presence flip splits the run.
    coalescer.accept(SID, chunkFrame({ index: 2, chunk: { type: 'tool-call-delta', index: 0, id: 't1', argumentsDelta: '!' } }), ++seq)
    coalescer.accept(SID, endFrame(3), ++seq)

    expect(seen).toEqual([
      chunkFrame({ chunk: { type: 'reasoning-delta', index: 0, text: 'think more' } }),
      endFrame(1),
      startFrame(),
      chunkFrame({ chunk: { type: 'tool-call-delta', index: 0, id: 't1', name: 'run', argumentsDelta: '{"a":1}' } }),
      chunkFrame({ index: 2, chunk: { type: 'tool-call-delta', index: 0, id: 't1', argumentsDelta: '!' } }),
      endFrame(3),
    ])
    coalescer.dispose()
  })

  it('flushes the open window synchronously when a boundary frame arrives, preserving order', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'b' } }), ++seq)
    coalescer.accept(SID, chunkFrame({ index: 1, chunk: { type: 'usage', usage: {} } }), ++seq)
    expect(seen).toEqual([
      chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'ab' } }),
      chunkFrame({ index: 1, chunk: { type: 'usage', usage: {} } }),
    ])
    coalescer.dispose()
  })

  it('never emits before the window elapses for mergeable deltas only', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)
    coalescer.accept(SID, chunkFrame(), ++seq)
    coalescer.accept(SID, chunkFrame(), ++seq)
    vi.advanceTimersByTime(32)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual([chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'xx' } })])
    coalescer.dispose()
  })

  it('passes every raw frame through unchanged when the window is zero', () => {
    const raw = [
      startFrame(),
      chunkFrame(),
      chunkFrame({ revision: 3, index: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } }),
      endFrame(2),
    ]
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 0)
    for (const frame of raw) coalescer.accept(SID, frame, ++seq)
    expect(seen).toEqual(raw)
  })

  it('drops an open window on disposeSession without publishing', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)
    coalescer.accept(SID, chunkFrame(), ++seq)
    coalescer.disposeSession(SID)
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])
  })

  it('flushSession publishes the open window synchronously', () => {
    const seen: SessionAssistantStreamFrame[] = []
    const coalescer = new AssistantStreamCoalescer((_, templates) => seen.push(...framesOf(templates)), 33)
    coalescer.accept(SID, chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } }), ++seq)
    coalescer.flushSession(SID)
    expect(seen).toEqual([chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } })])
    // The timer is gone: advancing time publishes nothing again.
    vi.advanceTimersByTime(100)
    expect(seen).toEqual([chunkFrame({ chunk: { type: 'text-delta', index: 0, text: 'a' } })])
  })
})
