// @vitest-environment jsdom
/** Voice-gate holds: arm on streaming prose, release on utterance/timeout, bypass when TTS is off. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type StatusResponse = { ok: boolean; body: { speakReplies?: boolean; streamingEnabled?: boolean } }

let statusResponse: StatusResponse = { ok: true, body: { speakReplies: true, streamingEnabled: true } }
let pendingItems: unknown[] = []
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const path = input instanceof Request ? input.url : String(input)
  if (path.endsWith('/dsh-tts/status')) {
    return new Response(JSON.stringify(statusResponse.body), { status: statusResponse.ok ? 200 : 503 })
  }
  if (path.endsWith('/dsh-tts/pending')) return new Response(JSON.stringify({ ok: true, items: pendingItems }), { status: 200 })
  throw new Error(`unexpected fetch ${path}`)
})

vi.stubGlobal('fetch', fetchMock)

class FakeEventSource {
  static last: FakeEventSource | undefined
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>()
  closed = false
  constructor(readonly url: string) { FakeEventSource.last = this }
  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  close(): void { this.closed = true }
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) })
  }
}

vi.stubGlobal('EventSource', FakeEventSource)

const { VoiceGate, HOLD_TIMEOUT_MS } = await import('../src/client/index.ts')

function prose(text: string, streaming = true): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-streaming', streaming ? '' : 'absent-marker-kept-for-query')
  if (!streaming) root.removeAttribute('data-streaming')
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  root.appendChild(paragraph)
  document.body.appendChild(root)
  return root
}

function reasoning(): HTMLElement {
  const span = document.createElement('span')
  span.setAttribute('data-streaming', '')
  document.body.appendChild(span)
  return span
}

const gates: Array<InstanceType<typeof VoiceGate>> = []

async function armedGate(): Promise<InstanceType<typeof VoiceGate>> {
  const gate = new VoiceGate()
  gates.push(gate)
  gate.arm()
  await vi.advanceTimersByTimeAsync(0)
  return gate
}

beforeEach(() => {
  vi.useFakeTimers()
  statusResponse = { ok: true, body: { speakReplies: true, streamingEnabled: true } }
  pendingItems = []
  fetchMock.mockClear()
})

afterEach(() => {
  for (const gate of gates) gate.dispose()
  gates.length = 0
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('voice gate', () => {
  it('holds streaming prose and releases it when the spoken text arrives', async () => {
    const gate = await armedGate()
    const root = prose('你好，世界。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    expect(gate.holding).toBe(true)
    FakeEventSource.last!.emit('utterance', { id: 'u1', text: '你好，世界。' })
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
    expect(gate.holding).toBe(false)
    gate.dispose()
  })

  it('ignores span markers (reasoning rows) and settled prose', async () => {
    await armedGate()
    reasoning()
    prose('已完成', false)
    await vi.advanceTimersByTimeAsync(0)
    expect(document.querySelectorAll('[data-voice-gate-hold]')).toHaveLength(0)
  })

  it('fails open after the timeout when no audio arrives', async () => {
    await armedGate()
    const root = prose('超时兜底。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    await vi.advanceTimersByTimeAsync(HOLD_TIMEOUT_MS)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
  })

  it('releases through the pending backfill after missing the SSE event', async () => {
    const gate = await armedGate()
    FakeEventSource.last!.close()
    const root = prose('断线补发。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    pendingItems.push({ id: 'u9', text: '断线补发。' })
    // The poll's backfill runs on the same 2s cadence as its status probe.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
    gate.dispose()
  })

  it('stops holding entirely when speak-replies is off', async () => {
    statusResponse = { ok: true, body: { speakReplies: false, streamingEnabled: true } }
    await armedGate()
    const root = prose('静音模式。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
  })

  it('releases every hold when speak-replies turns off mid-hold', async () => {
    const gate = await armedGate()
    const root = prose('中途关闭。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    statusResponse = { ok: true, body: { speakReplies: false, streamingEnabled: true } }
    await vi.advanceTimersByTimeAsync(2_000)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
    expect(FakeEventSource.last!.closed).toBe(true)
    gate.dispose()
  })

  it('keeps holding a settled paragraph until its audio arrives', async () => {
    await armedGate()
    const root = prose('先写完了。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    // Settling (streaming ended) is not a release: synthesis takes seconds more.
    root.removeAttribute('data-streaming')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(true)
    FakeEventSource.last!.emit('utterance', { id: 'u2', text: '先写完了。' })
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
  })

  it('stays bypassed when the status endpoint is absent (dsh-tts not composed)', async () => {
    // No status means no audio can ever arrive: holding every paragraph for
    // the timeout would flash text in late. The gate only holds when the
    // status probe positively confirms speak-replies.
    statusResponse = { ok: false, body: {} }
    await armedGate()
    const root = prose('无语音插件。')
    await vi.advanceTimersByTimeAsync(0)
    expect(root.hasAttribute('data-voice-gate-hold')).toBe(false)
  })
})
