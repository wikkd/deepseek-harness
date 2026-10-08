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
import {
  PET_ANCHOR_DEFAULT, PET_HEIGHT_DEFAULT, PET_HEIGHT_MAX, PET_HEIGHT_MIN,
  PET_LIP_SYNC_DEFAULT, PET_MOTION_RATE_DEFAULT, PET_OPACITY_DEFAULT,
  PET_OPACITY_MIN, PET_VISIBLE_DEFAULT,
} from './pet-settings.ts'

export { PET_SETTINGS_NAMESPACE, PET_VISIBLE_DEFAULT, PET_VISIBLE_FIELD, type PetSettings } from './pet-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Whether the pet floats in the client. */
  visible: Volatile<boolean>
  /** Displayed pet height in pixels. */
  height: Volatile<number>
  /** How see-through the pet renders, 0..1 where 1 is fully opaque. */
  opacity: Volatile<number>
  /** Which lower corner the pet docks to. */
  anchor: Volatile<'left' | 'right'>
  /** How often the pet changes its ambient motion while idle. */
  motionRate: Volatile<'calm' | 'normal' | 'lively'>
  /** Whether the pet's mouth follows the spoken replies. */
  lipSync: Volatile<boolean>
}

/** Live desktop-pet preferences. */
export const Config = z.object({
  visible: z.boolean().default(PET_VISIBLE_DEFAULT).volatile(),
  height: z.number().min(PET_HEIGHT_MIN).max(PET_HEIGHT_MAX).default(PET_HEIGHT_DEFAULT).volatile(),
  opacity: z.number().min(PET_OPACITY_MIN).max(1).default(PET_OPACITY_DEFAULT).volatile(),
  anchor: z.union(['left', 'right']).default(PET_ANCHOR_DEFAULT).volatile(),
  motionRate: z.union(['calm', 'normal', 'lively']).default(PET_MOTION_RATE_DEFAULT).volatile(),
  lipSync: z.boolean().default(PET_LIP_SYNC_DEFAULT).volatile(),
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
