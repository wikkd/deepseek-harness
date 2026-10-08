/**
 * 小圆 emotion expressions, browser half. Observes the current session's
 * durable event window, classifies every settled assistant message with the
 * rule-based classifier, and dispatches one `dsh-emotion:expression` window
 * CustomEvent per reply. The Live2D pet (ui-live2d-avatar) listens for that
 * event and swaps its expression — the two plugins share only this event,
 * so either can be absent without breaking the other.
 * @module @deepseek-ai/dsh-client-ui-emotion-express/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { classifyEmotion, visibleAssistantText } from '../classifier.ts'
import { EMOTION_EVENT } from '../emotion-event.ts'

/**
 * Services required by the browser half. `sessions` feeds the event-window
 * observation; it is resolved defensively, so a composition without it only
 * loses the feature.
 */
export const inject: string[] = ['sessions']

/** The assistant-message payload this plugin classifies. */
type AssistantMessageEvent = SessionEvent<'assistant/message'>

/** The face of the sessions service this plugin consumes. */
interface SessionsFace {
  list: {
    getSnapshot(): { byId: Readonly<Record<string, { retainedBy?: { mainView?: number } }>> }
    subscribe(listener: () => void): () => void
  }
  binding(sessionId: string): SessionBinding | undefined
  retainInfo(sessionId: string): {
    getSnapshot(): { retainedBy?: { mainView?: number } }
    subscribe(listener: () => void): () => void
  }
}

/**
 * Extract the event of one event-window entry, transparently unwrapping the
 * transport discriminator.
 * @param entry - one event-window entry.
 * @returns the inner event, or undefined for foreign shapes.
 */
function entryEvent(entry: unknown): AssistantMessageEvent | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const record = entry as { readonly event?: unknown }
  const event = record.event
  if (typeof event !== 'object' || event === null) return undefined
  const candidate = event as { readonly type?: unknown; readonly data?: unknown }
  if (candidate.type !== 'assistant/message') return undefined
  return event as AssistantMessageEvent
}

/**
 * Observe the main-view session binding: subscribe to its event source and
 * classify every appended `assistant/message`. Returns the disposer that
 * detaches from the current binding; the caller re-arms after session
 * switches.
 * @param ctx - client context holding the sessions service.
 * @param dispatch - the emotion dispatcher.
 * @returns disposer for the current observation.
 */
function observeBinding(ctx: ClientContext, dispatch: (event: EmotionDispatch) => void): () => void {
  const sessions = (ctx as unknown as { get(service: string): unknown }).get('sessions') as SessionsFace | undefined
  if (sessions === undefined) return () => {}
  const byId = sessions.list.getSnapshot().byId
  const currentId = Object.keys(byId)
    .find(id => (byId[id]?.retainedBy?.mainView ?? 0) > 0)
  if (currentId === undefined) return () => {}
  const binding = sessions.binding(currentId)
  if (binding === undefined) return () => {}
  const stop = binding.eventSource.subscribe(() => {
    const { change } = binding.eventSource.getSnapshot()
    if (change.kind !== 'append' && change.kind !== 'settle-assistant') return
    for (const entry of change.kind === 'append' ? change.entries : []) {
      const event = entryEvent(entry)
      if (event === undefined || event.data.interrupted === true) continue
      dispatch({
        emotion: classifyEmotion(visibleAssistantText(event.data.message.content)),
        seq: event.seq,
      })
    }
  })
  return stop
}

/** One pending emotion dispatch. */
interface EmotionDispatch {
  /** The classified emotion. */
  emotion: ReturnType<typeof classifyEmotion>
  /** The producing event's seq. */
  seq: number
}

/**
 * Mount the emotion observer. Session switches re-arm the event-source
 * subscription; every classified reply dispatches the window event the pet
 * consumes.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    let lastSeq = -1
    let stop: (() => void) | undefined
    let stopList: (() => void) | undefined
    const dispatch = (item: EmotionDispatch): void => {
      // Exactly-once per durable seq: replays and re-settlements stay silent.
      if (item.seq <= lastSeq) return
      lastSeq = item.seq
      window.dispatchEvent(new CustomEvent(EMOTION_EVENT, { detail: { emotion: item.emotion, seq: item.seq } }))
    }
    const rearm = (): void => {
      stop?.()
      stop = observeBinding(ctx, dispatch)
    }
    const sessions = (ctx as unknown as { get(service: string): unknown }).get('sessions') as SessionsFace | undefined
    if (sessions !== undefined) {
      stopList = sessions.list.subscribe(rearm)
      rearm()
    }
    return () => {
      stopList?.()
      stop?.()
      stop = undefined
    }
  }, 'ui-emotion-express: classify assistant replies')
}
