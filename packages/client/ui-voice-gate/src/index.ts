/**
 * Voice-sync gate plugin, node half. The feature lives entirely in the browser
 * half: this entry only disables the auto-generated settings page (the gate is
 * configured through the dsh-tts plugin it observes, not its own surface).
 * @module @deepseek-ai/dsh-client-ui-voice-gate
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

/**
 * Turn off the auto-generated settings page for this entry: the gate has no
 * preference of its own — it follows the dsh-tts plugin's Speak-replies state.
 * @param ctx Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
