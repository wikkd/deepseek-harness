/**
 * Functional taxonomy of the settings panel. Registrants keep contributing
 * `settings.section` pages exactly as before — the shell additionally sorts
 * every contributed page into one of a few functional categories, so the nav
 * reads as "what it does" rather than "which plugin shipped it". A page lands
 * in a category by its declared `category` registration option first, then by
 * the known-id map below, and anything unrecognized counts as a plugin
 * extension (`plugins`), so a third-party page can never disappear.
 */

/** Stable category ids; doubles as the nav-icon key set. */
export type SettingsCategoryId = 'account' | 'general' | 'agent' | 'desktop' | 'plugins'

/** One nav group: ordered category with its shell-owned label key. */
export interface SettingsCategory {
  id: SettingsCategoryId
  order: number
  /** Locale key under the shell's `settings` namespace. */
  labelKey: string
}

/** The full ordered category list — the nav renders groups in this order. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: 'account', order: 0, labelKey: 'category.account' },
  { id: 'general', order: 1, labelKey: 'category.general' },
  { id: 'agent', order: 2, labelKey: 'category.agent' },
  { id: 'desktop', order: 3, labelKey: 'category.desktop' },
  { id: 'plugins', order: 4, labelKey: 'category.plugins' },
]

/** Where every known section id lives today (repo-owned and shipped plugins). */
const SECTION_CATEGORY: Readonly<Record<string, SettingsCategoryId>> = {
  'account': 'account',
  'general': 'general',
  'archived-sessions': 'general',
  'models': 'agent',
  'agent-presets': 'agent',
  'live2d-avatar': 'desktop',
  'better-sidebar': 'desktop',
  'keep-awake': 'desktop',
  'plugins': 'plugins',
}

/**
 * Resolve one section's category: the registrant's declared `category`
 * option wins, then the known-id map, then the plugin-extension fallback.
 * @param id - the section registration id.
 * @param declared - the registrant's `category` option, when it declares one.
 * @returns the category the shell files this section under.
 */
export function resolveCategory(id: string, declared?: string): SettingsCategoryId {
  if (declared !== undefined && SETTINGS_CATEGORIES.some(c => c.id === declared)) {
    return declared as SettingsCategoryId
  }
  return SECTION_CATEGORY[id] ?? 'plugins'
}
