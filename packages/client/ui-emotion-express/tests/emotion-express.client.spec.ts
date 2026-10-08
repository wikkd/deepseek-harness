// @vitest-environment jsdom
/** The browser half classifies appended assistant messages and dispatches the window emotion event. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** One fake event window carrying its entries and the latest change. */
interface FakeWindow {
  entries: readonly unknown[]
  change: { kind: 'replace' | 'append'; entries: readonly unknown[] }
}

/** One fake session binding with its event window and listener set. */
interface FakeBinding {
  source: FakeWindow
  listeners: Set<() => void>
}

const bindings = new Map<string, FakeBinding>()

let byId: Record<string, { retainedBy: { mainView: number } }> = {}

const sessionsFace = {
  list: {
    getSnapshot: () => ({ byId }),
    subscribe: (listener: () => void) => {
      listListeners.add(listener)
      return () => { listListeners.delete(listener) }
    },
  },
  binding: (sessionId: string) => {
    const owner = bindings.get(sessionId)
    if (owner === undefined) return undefined
    return {
      sessionId,
      eventSource: {
        getSnapshot: () => owner.source,
        subscribe: (listener: () => void) => {
          owner.listeners.add(listener)
          return () => { owner.listeners.delete(listener) }
        },
      },
    }
  },
  retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }), subscribe: () => () => {} }),
}

const listListeners = new Set<() => void>()

/** Disposers registered through the fake ctx.effect, drained afterEach. */
const effects: Array<() => void> = []

/** Fake client context: effect() runs the callback and keeps its disposer. */
function fakeCtx(): Parameters<typeof apply>[0] {
  return {
    get: () => sessionsFace,
    effect: (callback: () => () => void) => {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
  } as unknown as Parameters<typeof apply>[0]
}

function assistantMessage(seq: number, text: string, interrupted?: true): unknown {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq,
      time: 1_700_000_000_000 + seq,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: seq,
        message: { id: `m${seq}`, role: 'assistant', source: {}, content: [{ type: 'text', text }] },
        stream: [],
        ...(interrupted === true ? { interrupted: true } : {}),
      },
    },
  }
}

function makeSession(id: string): { source: FakeWindow; listeners: Set<() => void> } {
  const owner = {
    source: { entries: [], change: { kind: 'replace' as const, entries: [] } },
    listeners: new Set<() => void>(),
  }
  bindings.set(id, owner)
  return owner
}

const emitted: Array<{ emotion: string; seq: number }> = []
const onEmotion = (event: Event): void => {
  const detail = (event as CustomEvent<{ emotion: string; seq: number }>).detail
  emitted.push(detail)
}

const { apply } = await import('../src/client/index.ts')

beforeEach(() => {
  byId = {}
  bindings.clear()
  listListeners.clear()
  emitted.length = 0
  window.addEventListener('dsh-emotion:expression', onEmotion)
})

afterEach(() => {
  window.removeEventListener('dsh-emotion:expression', onEmotion)
  for (const dispose of effects) dispose()
  effects.length = 0
  vi.restoreAllMocks()
})

describe('ui-emotion-express client', () => {
  it('dispatches one event per appended assistant message with its classified emotion', () => {
    byId = { 's1': { retainedBy: { mainView: 1 } } }
    const owner = makeSession('s1')
    const ctx = fakeCtx()
    apply(ctx)
    owner.source = {
      entries: [assistantMessage(3, '太好了，成功啦！')],
      change: { kind: 'append', entries: [assistantMessage(3, '太好了，成功啦！')] },
    }
    for (const listener of owner.listeners) listener()
    expect(emitted).toEqual([{ emotion: 'happy', seq: 3 }])

  })

  it('skips interrupted messages and non-assistant events', () => {
    byId = { 's1': { retainedBy: { mainView: 1 } } }
    const owner = makeSession('s1')
    const ctx = fakeCtx()
    apply(ctx)
    const interrupted = assistantMessage(4, '呜呜', true)
    owner.source = {
      entries: [interrupted, { type: 'event', event: { type: 'user/message', seq: 5, data: {} } }],
      change: { kind: 'append', entries: [interrupted, { type: 'event', event: { type: 'user/message', seq: 5, data: {} } }] },
    }
    for (const listener of owner.listeners) listener()
    expect(emitted).toEqual([])
  })

  it('re-arms onto the new session when the list changes', () => {
    byId = { 's1': { retainedBy: { mainView: 1 } } }
    const first = makeSession('s1')
    const ctx = fakeCtx()
    apply(ctx)
    byId = { 's2': { retainedBy: { mainView: 1 } } }
    const second = makeSession('s2')
    for (const listener of listListeners) listener()
    second.source = {
      entries: [assistantMessage(7, '哇，没想到！')],
      change: { kind: 'append', entries: [assistantMessage(7, '哇，没想到！')] },
    }
    for (const listener of second.listeners) listener()
    expect(emitted).toEqual([{ emotion: 'surprised', seq: 7 }])
    // The old binding's subscription was dropped with the re-arm.
    first.source = {
      entries: [assistantMessage(8, '哈哈')],
      change: { kind: 'append', entries: [assistantMessage(8, '哈哈')] },
    }
    for (const listener of first.listeners) listener()
    expect(emitted).toEqual([{ emotion: 'surprised', seq: 7 }])

  })

  it('ignores stale seqs so replays stay silent', () => {
    byId = { 's1': { retainedBy: { mainView: 1 } } }
    const owner = makeSession('s1')
    const ctx = fakeCtx()
    apply(ctx)
    owner.source = {
      entries: [assistantMessage(3, '太好了，成功啦！')],
      change: { kind: 'append', entries: [assistantMessage(3, '太好了，成功啦！')] },
    }
    for (const listener of owner.listeners) listener()
    owner.source = {
      entries: [assistantMessage(3, '太好了，成功啦！')],
      change: { kind: 'append', entries: [assistantMessage(3, '太好了，成功啦！')] },
    }
    for (const listener of owner.listeners) listener()
    expect(emitted).toEqual([{ emotion: 'happy', seq: 3 }])

  })

  it('dispatches nothing without a main-view session', () => {
    const ctx = fakeCtx()
    apply(ctx)
    expect(emitted).toEqual([])

  })
})
