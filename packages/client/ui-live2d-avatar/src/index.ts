/**
 * 小圆 Live2D desktop-pet avatar plugin, node half. Declares the pet's user
 * preference schema (volatile: the Web settings page edits it live) and turns
 * off the auto-generated settings page — the browser half renders its own
 * preference row. The pet itself ships through `exports["./client"]`.
 * @module @deepseek-ai/dsh-client-ui-live2d-avatar
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { PET_VISIBLE_DEFAULT } from './pet-settings.ts'

export { PET_SETTINGS_NAMESPACE, PET_VISIBLE_DEFAULT, PET_VISIBLE_FIELD, type PetSettings } from './pet-settings.ts'

/** Runtime preference projected to the browser. */
export interface Config {
  /** Whether the pet floats in the client. */
  visible: Volatile<boolean>
}

/** Live desktop-pet preference. */
export const Config = z.object({
  visible: z.boolean().default(PET_VISIBLE_DEFAULT).volatile(),
})

/**
 * Turn off the auto-generated settings page for this entry: the pet feature
 * owns its settings surface (the browser half registers the row). The
 * validated preference is consumed by the browser half through the settings
 * service, not here.
 * @param ctx Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
