/** Coalesces dense assistant-stream delta frames per Session before fan-out. */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionAssistantStreamFrame } from './types.ts'

type AssistantChunkFrame = Extract<SessionAssistantStreamFrame, { readonly type: 'chunk' }>

/**
 * One window output. `raw` is the first raw wire frame the template
 * represents: the passthrough-mode identity source and the metadata donor
 * (attemptId, time, startedAfterSeq, outcome) for coalesced re-emission.
 * `rawSeq` is the shared per-session raw frame ordinal used for cut filtering.
 */
export interface AssistantStreamTemplate {
  readonly raw: SessionAssistantStreamFrame
  readonly rawSeq: number
}

/** One mergeable delta held open inside a session window. */
interface PendingDelta {
  /** First raw chunk frame; donates attemptId/time and passthrough identity. */
  readonly first: AssistantChunkFrame
  readonly rawSeq: number
  readonly kind: 'text' | 'reasoning' | 'tool'
  readonly index: number
  /** tool-call-delta only. */
  readonly id?: string
  readonly hasName?: boolean
  readonly name?: string
  texts?: string[]
  args?: string[]
}

interface SessionWindow {
  readonly pending: PendingDelta[]
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Mergeable-delta classifier. Only dense deltas merge; every boundary frame
 * (start/end, block start and end, usage, finish) passes through immediately.
 * A malformed delta payload degrades to non-mergeable rather than failing the
 * host.
 */
function mergeableKind(frame: AssistantChunkFrame): PendingDelta['kind'] | undefined {
  const chunk = frame.chunk as { type?: unknown; text?: unknown; id?: unknown; argumentsDelta?: unknown }
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' ? (chunk.type === 'text-delta' ? 'text' : 'reasoning') : undefined
  }
  if (chunk.type === 'tool-call-delta'
    && typeof chunk.id === 'string'
    && typeof chunk.argumentsDelta === 'string') {
    return 'tool'
  }
  return undefined
}

/** Whether the window's tail absorbs one more delta frame; mutates it when so. */
function mergeIntoTail(pending: PendingDelta[], frame: AssistantChunkFrame): boolean {
  const tail = pending.at(-1)
  if (tail === undefined) return false
  if (tail.first.attemptId !== frame.attemptId) return false
  const chunk = frame.chunk as { type?: unknown; index?: unknown; text?: unknown; id?: unknown; name?: unknown; argumentsDelta?: unknown }
  if (chunk.index !== tail.index) return false
  if (tail.kind === 'text' && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
    tail.texts?.push(chunk.text)
    return true
  }
  if (tail.kind === 'reasoning' && chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
    tail.texts?.push(chunk.text)
    return true
  }
  if (tail.kind === 'tool' && chunk.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') {
    // Same rule as the dsh-llm compressor: identical id, and the own-property
    // presence of `name` must agree together with its value.
    const sameName = Object.hasOwn(chunk, 'name') === (tail.hasName ?? false)
      && (!tail.hasName || (tail.name === chunk.name && typeof chunk.name === 'string'))
    if (chunk.id === tail.id && sameName) {
      tail.args?.push(chunk.argumentsDelta)
      return true
    }
  }
  return false
}

/** Materialize one pending delta into the template it contributes to the fan-out. */
function templateOf(entry: PendingDelta): AssistantStreamTemplate {
  if (entry.texts !== undefined) {
    const chunk = entry.first.chunk as { type: 'text-delta' | 'reasoning-delta'; index: number; text: string }
    return {
      raw: {
        ...entry.first,
        chunk: { ...chunk, text: entry.texts.join('') },
      },
      rawSeq: entry.rawSeq,
    }
  }
  const chunk = entry.first.chunk as { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  return {
    raw: {
      ...entry.first,
      chunk: {
        type: chunk.type,
        index: chunk.index,
        id: chunk.id,
        argumentsDelta: (entry.args ?? [chunk.argumentsDelta]).join(''),
        ...entry.hasName ? { name: entry.name } : {},
      },
    },
    rawSeq: entry.rawSeq,
  }
}

/**
 * Per-Session coalescing of dense assistant-stream delta frames. Mergeable
 * deltas open a timed window and merge while adjacent-compatible; every
 * boundary frame flushes the window synchronously and passes through alone,
 * so the fan-out order always equals the raw frame order. `windowMs === 0`
 * passes every raw frame through unchanged (the rollback identity).
 */
export class AssistantStreamCoalescer {
  private readonly windows = new Map<SessionId, SessionWindow>()

  constructor(
    private readonly distribute: (sessionId: SessionId, templates: readonly AssistantStreamTemplate[]) => void,
    private readonly windowMs: number,
  ) {}

  /** Offer one raw wire frame; mergeable deltas may wait for the window, everything else flushes through. */
  accept(sessionId: SessionId, frame: SessionAssistantStreamFrame, rawSeq: number): void {
    if (this.windowMs === 0) {
      this.distribute(sessionId, [{ raw: frame, rawSeq }])
      return
    }
    if (frame.type === 'chunk') {
      const kind = mergeableKind(frame)
      if (kind !== undefined) {
        let window = this.windows.get(sessionId)
        if (window === undefined) {
          window = { pending: [], timer: undefined }
          this.windows.set(sessionId, window)
        }
        if (!mergeIntoTail(window.pending, frame)) {
          const chunk = frame.chunk as {
            index: number
            text?: unknown
            id?: unknown
            name?: unknown
            argumentsDelta?: unknown
          }
          if (kind === 'text' || kind === 'reasoning') {
            window.pending.push({
              first: frame,
              rawSeq,
              kind,
              index: chunk.index,
              texts: [chunk.text as string],
            })
          } else {
            const hasName = Object.hasOwn(chunk, 'name')
            window.pending.push({
              first: frame,
              rawSeq,
              kind,
              index: chunk.index,
              id: chunk.id as string,
              hasName,
              ...(hasName ? { name: chunk.name as string } : {}),
              args: [chunk.argumentsDelta as string],
            })
          }
          window.timer ??= setTimeout(() => { this.flushSession(sessionId) }, this.windowMs)
          window.timer.unref()
          return
        }
        return
      }
    }
    // A boundary frame (or a malformed delta): publish the open window first,
    // then this frame alone, preserving raw frame order.
    this.flushSession(sessionId)
    this.distribute(sessionId, [{ raw: frame, rawSeq }])
  }

  /** Synchronously publish the session's open window, if any (follower registration boundary). */
  flushSession(sessionId: SessionId): void {
    const window = this.windows.get(sessionId)
    if (window === undefined) return
    if (window.timer !== undefined) clearTimeout(window.timer)
    this.windows.delete(sessionId)
    if (window.pending.length === 0) return
    this.distribute(sessionId, window.pending.map(templateOf))
  }

  /** Drop one session's open window without publishing (no followers remain, or the Agent retired). */
  disposeSession(sessionId: SessionId): void {
    const window = this.windows.get(sessionId)
    if (window === undefined) return
    if (window.timer !== undefined) clearTimeout(window.timer)
    this.windows.delete(sessionId)
  }

  /** Drop every open window (controller teardown). */
  dispose(): void {
    for (const sessionId of [...this.windows.keys()]) this.disposeSession(sessionId)
  }
}
