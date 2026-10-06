/** Client half of the image-generation plugin: registers the generate_image Tool card. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { ImageGenRow } from './ImageGenRow.tsx'
import { NS, en, zh } from './locales.ts'

/** Client services: the slot registry hosting the keyed Tool view and the locale store. */
export const inject = ['slots', 'locale'] as const

/**
 * Register the locale dictionaries and the keyed Tool card.
 * @param ctx - the client context of this plugin entry.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'generate_image',
      locale: NS,
    }, ImageGenRow))
}
