/**
 * Long-term memory settings page, browser half: first-run consent, an
 * availability switch, and the explicit view/edit/delete/clear surface over
 * the generated `remote.memory` namespace.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the memory namespace face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MemorySection } from './MemorySection.tsx'
import { MemorySectionController, type MemorySectionInjected } from './controller.ts'
import { en, zh, type MemorySettingsKey } from './locales.ts'

export type { MemorySectionProps } from './MemorySection.tsx'
export type { MemorySectionInjected, MemorySectionState } from './controller.ts'
export type { MemorySettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Long-term memory settings page copy. */
    'settings.memory': MemorySettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.memory'

/** Required services (Cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.memory']

/**
 * Mount the memory settings page.
 * @param ctx - Browser plugin context carrying slots, locale, and Remote.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const controller = new MemorySectionController(ctx)
  // Stable across renders: the page starts its one read from an effect keyed
  // by this function, and a fresh arrow here would re-run that effect forever.
  const load = (): Promise<void> => controller.load()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-memory: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): MemorySectionInjected => ({
      hooks: { memory: controller.store },
      load,
      consent: () => controller.consent(),
      setEnabled: enabled => controller.setEnabled(enabled),
      save: (text, kind) => controller.save(text, kind),
      update: (id, text) => controller.update(id, text),
      forget: id => controller.forget(id),
      clear: () => controller.clear(),
    }),
  }, MemorySection))
}
