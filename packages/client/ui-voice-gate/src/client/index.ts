/**
 * Voice-sync gate, browser half. While the dsh-tts plugin speaks replies, a
 * finished streaming paragraph is held invisible until its spoken audio is
 * ready, so the user hears a sentence as it first appears instead of reading
 * past a silent screen.
 *
 * The gate is DOM-level on purpose: it observes the chat view's streaming
 * prose marker (`div[data-streaming]` — the AssistantMarkdown root; the
 * ReasoningRow marker is a span and never matches) and toggles a data
 * attribute that one injected stylesheet turns into `visibility: hidden`.
 * Layout is preserved, so scroll position and the turn rail stay put.
 *
 * Readiness comes from the same signals the dsh-tts player consumes: the
 * `/dsh-tts/stream` SSE (`utterance` and `error` events) plus a `/dsh-tts/pending`
 * poll as reconnect backfill. A hold released by neither signal opens on its
 * own after `HOLD_TIMEOUT_MS` — a failed synthesis must not hide the reply.
 * @module @deepseek-ai/dsh-client-ui-voice-gate/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Required service: none — the gate talks HTTP and DOM only. */
export const inject: string[] = []

/** Milliseconds before an unreleased hold fails open and shows the prose. */
export const HOLD_TIMEOUT_MS = 12_000
/** Milliseconds between `/dsh-tts/pending` polls that backfill missed SSE items. */
const POLL_INTERVAL_MS = 2_000

/** One held paragraph: its root element and its fail-open timer. */
interface Hold {
  readonly root: HTMLElement
  timer: ReturnType<typeof setTimeout>
}

/** Wire shape of one settled synthesis item on the dsh-tts stream/pending list. */
interface TtsItem {
  id?: unknown
  kind?: unknown
  text?: unknown
  error?: unknown
}

/**
 * Whether a wire value is a non-empty string.
 * @param value - value read off a JSON payload.
 * @returns true for a string with content.
 */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Collapse a prose string the way dsh-tts scrubs it before synthesis, so held
 * text and spoken text compare equal across Markdown decoration. The gate only
 * needs a stable prefix comparison, not parity with every scrub rule.
 * @param raw - prose text as rendered.
 * @returns comparison key: code fences, inline code, and decoration stripped.
 */
function scrubLikeTts(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>]+/g, ' ')
    .replace(/MEDIA:\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Owns the stylesheet, the SSE connection, the pending poll, and the live hold
 * set. One instance per browser session; `dispose` tears everything down.
 */
export class VoiceGate {
  /** style element carrying the hold rule. */
  private readonly style: HTMLStyleElement
  /** event source for utterance releases; absent until armed. */
  private source: EventSource | undefined
  /** periodic pending backfill; absent until armed. */
  private poll: ReturnType<typeof setInterval> | undefined
  /** live holds keyed by their root element. */
  private readonly holds = new Map<HTMLElement, Hold>()
  /** released utterance texts, scrubbed, most recent last. */
  private readonly spoken: string[] = []
  /** observers per document, watching for streaming prose. */
  private readonly observers = new Set<MutationObserver>()
  /** observers currently scheduled to flush on the next microtask. */
  private readonly queued = new Set<MutationObserver>()
  /** last known dsh-tts speak state: unknown until the first status probe lands. */
  private speaking: boolean | undefined = undefined
  /** settled state: disarmed, armed, or torn down. */
  private state: 'disarmed' | 'armed' | 'disposed' = 'disarmed'

  constructor() {
    this.style = document.createElement('style')
    this.style.textContent = '[data-voice-gate-hold] { visibility: hidden; }'
    this.style.setAttribute('data-dsh-plugin', 'ui-voice-gate')
  }

  /**
   * Whether the gate currently holds at least one paragraph.
   * @returns true while any prose is hidden awaiting audio.
   */
  get holding(): boolean {
    return this.holds.size > 0
  }

  /**
   * Start observing the document and listening to dsh-tts readiness. Safe to
   * call repeatedly; only the first call arms the gate.
   */
  arm(): void {
    if (this.state !== 'disarmed') return
    this.state = 'armed'
    document.head.appendChild(this.style)
    for (const doc of [document]) this.watch(doc)
    void this.pollStatus()
  }

  /**
   * Tear down every resource this gate owns: observer, SSE, poll, holds.
   * Held paragraphs are released so nothing stays hidden.
   */
  dispose(): void {
    if (this.state === 'disposed') return
    this.state = 'disposed'
    for (const observer of this.observers) observer.disconnect()
    this.observers.clear()
    this.queued.clear()
    this.closeStream()
    this.releaseAll()
    this.style.remove()
  }

  /**
   * Close the SSE connection and stop the pending poll without disarming
   * the document observer — used between status flips.
   */
  private closeStream(): void {
    if (this.source !== undefined) {
      try { this.source.close() } catch { /* already closed */ }
      this.source = undefined
    }
    if (this.poll !== undefined) {
      clearInterval(this.poll)
      this.poll = undefined
    }
  }

  /**
   * Probe `/dsh-tts/status`, connect or drop the stream to match the plugin's
   * speak-replies state, and backfill settled items from the pending list.
   * Polling continues while armed so a settings toggle flips the gate live.
   */
  private async pollStatus(): Promise<void> {
    if (this.state !== 'armed') return
    let status: { speakReplies?: unknown; streamingEnabled?: unknown } | undefined
    try {
      const response = await fetch('/dsh-tts/status', { cache: 'no-store' })
      if (response.ok) status = await response.json() as typeof status
    } catch { /* host restarting or route absent — stay in the unknown state */ }
    const speaking = status?.speakReplies === true
    this.speaking = status === undefined ? undefined : speaking
    if (speaking) {
      if (this.source === undefined) this.connect()
      void this.readPending()
    } else if (this.source !== undefined) {
      this.closeStream()
      this.releaseAll()
    }
    // pollStatus re-enters asynchronously through the interval, so the state
    // guard is a real re-check, not a literal comparison the compiler folds.
    const armedNow: string = this.state
    if (armedNow === 'armed') {
      this.poll ??= setInterval(() => { void this.pollStatus() }, POLL_INTERVAL_MS)
    }
  }

  /**
   * Open the SSE stream. Reconnection is EventSource-native; the status poll
   * backfills settled items from `/dsh-tts/pending` each tick.
   */
  private connect(): void {
    const source = new EventSource('/dsh-tts/stream')
    this.source = source
    source.addEventListener('utterance', (event) => { this.accept(this.parse(event)) })
    source.addEventListener('error', (event) => { this.accept(this.parse(event)) })
    source.onerror = () => { /* EventSource retries natively; the pending poll backfills */ }
  }

  /**
   * Backfill from `/dsh-tts/pending`: items that settled while the SSE was
   * down are released here. Only settled, non-reserved items count.
   */
  private async readPending(): Promise<void> {
    if (this.state !== 'armed') return
    try {
      const response = await fetch('/dsh-tts/pending', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { items?: unknown }
      if (!Array.isArray(data.items)) return
      for (const item of data.items) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as TtsItem
        // Reserved slots mean synthesis is still running; later items must not
        // release ahead of their turn, so stop at the first one.
        if (record.kind === 'reserved') break
        this.accept(record)
      }
    } catch { /* host restarting — the next poll retries */ }
  }

  /**
   * Parse one SSE event into a wire item.
   * @param event - MessageEvent from the dsh-tts stream.
   * @returns the parsed item, or null when the payload is not JSON.
   */
  private parse(event: Event): TtsItem | null {
    const data = (event as MessageEvent<unknown>).data
    if (!isText(data)) return null
    try { return JSON.parse(data) as TtsItem } catch { return null }
  }

  /**
   * Consume one settled dsh-tts item: an utterance or a failure releases the
   * holds its text (or the failure's fallback) covers.
   * @param item - parsed wire item.
   */
  private accept(item: TtsItem | null): void {
    if (item === null) return
    if (isText(item.text)) {
      const key = scrubLikeTts(item.text)
      this.spoken.push(key)
      if (this.spoken.length > 64) this.spoken.shift()
      this.releaseFor(key)
    }
  }

  /**
   * Release every hold whose prose begins with the spoken key, or whose spoken
   * key begins with the prose (sentence splitting can cut either way).
   * @param key - scrubbed spoken text.
   */
  private releaseFor(key: string): void {
    for (const [root, hold] of this.holds) {
      if (this.covers(root.textContent, key)) this.release(root, hold)
    }
  }

  /**
   * Prefix match in both directions with the scrub applied.
   * @param prose - rendered paragraph text.
   * @param spoken - scrubbed spoken text.
   * @returns true when one text starts the other.
   */
  private covers(prose: string, spoken: string): boolean {
    const a = scrubLikeTts(prose)
    if (a === '') return false
    return a.startsWith(spoken) || spoken.startsWith(a)
  }

  /**
   * Watch a document for streaming prose and settled paragraphs.
   * @param doc - document to observe (the client renders one).
   */
  private watch(doc: Document): void {
    const observer = new MutationObserver(() => { this.schedule(observer) })
    observer.observe(doc, { childList: true, subtree: true, characterData: true })
    this.observers.add(observer)
    this.scan(doc)
  }

  /**
   * Coalesce a burst of mutations into one scan on the next microtask.
   * @param observer - the observer whose mutations scheduled this flush.
   */
  private schedule(observer: MutationObserver): void {
    if (this.queued.has(observer)) return
    this.queued.add(observer)
    queueMicrotask(() => {
      this.queued.delete(observer)
      if (this.state !== 'armed') return
      this.scan(document)
    })
  }

  /**
   * Reconcile the DOM with the hold set: arm holds on streaming prose while
   * dsh-tts speaks, and release holds that no longer qualify — the stream
   * ended, the toggle went off, or the text already played.
   * @param doc - document to scan.
   */
  private scan(doc: Document): void {
    if (this.speaking !== true) {
      this.releaseAll()
      return
    }
    const roots = doc.querySelectorAll<HTMLElement>('div[data-streaming]')
    const seen = new Set<HTMLElement>()
    for (const root of roots) {
      if (!this.streamsProse(root)) continue
      seen.add(root)
      if (!this.holds.has(root)) this.hold(root)
    }
    for (const [root, hold] of this.holds) {
      if (!seen.has(root)) this.release(root, hold)
    }
    // An utterance that arrived while its paragraph was still streaming is
    // already in `spoken`; re-check so a race between the two signals settles.
    for (const [root, hold] of this.holds) {
      for (const key of this.spoken) {
        if (this.covers(root.textContent, key)) {
          this.release(root, hold)
          break
        }
      }
    }
  }

  /**
   * Whether one `data-streaming` element is assistant prose: the AssistantMarkdown
   * root is a div and carries prose children; the ReasoningRow marker is a span.
   * @param root - candidate element.
   * @returns true when the element qualifies for a hold.
   */
  private streamsProse(root: HTMLElement): boolean {
    return root.tagName === 'DIV' && root.querySelector('p, li, pre, table, h1, h2, h3, h4, h5, h6') !== null
  }

  /**
   * Hold one paragraph: mark it, record it, start its fail-open timer.
   * @param root - streaming prose element.
   */
  private hold(root: HTMLElement): void {
    const hold: Hold = { root, timer: setTimeout(() => { this.release(root, hold) }, HOLD_TIMEOUT_MS) }
    this.holds.set(root, hold)
    root.setAttribute('data-voice-gate-hold', '')
  }

  /**
   * Release one hold: unmark it, stop its timer, drop the record.
   * @param root - held element.
   * @param hold - the hold record for that element.
   */
  private release(root: HTMLElement, hold: Hold): void {
    clearTimeout(hold.timer)
    this.holds.delete(root)
    root.removeAttribute('data-voice-gate-hold')
  }

  /**
   * Release every hold — the fail-open for a TTS toggle-off or teardown.
   */
  private releaseAll(): void {
    for (const [root, hold] of [...this.holds]) this.release(root, hold)
  }
}

/**
 * Install the voice gate in the browser: one instance per client context,
 * armed immediately and torn down with the plugin effect.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const gate = new VoiceGate()
  gate.arm()
  ctx.effect(() => () => { gate.dispose() }, 'ui-voice-gate: hold prose until spoken')
}
