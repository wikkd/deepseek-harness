/**
 * The cross-plugin contract between the emotion producer (ui-emotion-express)
 * and the expression consumer (ui-live2d-avatar): one window CustomEvent name
 * plus its payload. Declared once here so both packages share the spelling
 * without a runtime dependency; the consumer's half re-exports the types from
 * this module. `ui-live2d-avatar` does not depend on this package — it
 * declares the same structural shape locally.
 * @module @deepseek-ai/dsh-client-ui-emotion-express/emotion-event
 */
import type { EmotionKey } from './classifier.ts'

/** Window CustomEvent name carrying one classified assistant-reply emotion. */
export const EMOTION_EVENT = 'dsh-emotion:expression'

/** Payload carried by every {@link EMOTION_EVENT} dispatch. */
export interface EmotionEventDetail {
  /** The classified emotion for the assistant's latest visible reply. */
  readonly emotion: EmotionKey
  /** Durable session seq of the `assistant/message` event that produced it. */
  readonly seq: number
}

/** The window-level type merge consumers observe. */
declare global {
  interface WindowEventMap {
    /** One classified assistant-reply emotion from ui-emotion-express. */
    [EMOTION_EVENT]: CustomEvent<EmotionEventDetail>
  }
}

export type { EmotionKey }
