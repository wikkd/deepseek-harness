/**
 * The desktop pet's user preference, shared by both plugin halves: the host
 * half declares the schema, the browser half reads and writes it through the
 * settings service. The namespace is the profile entry id the settings forms
 * address, so it must match the plugin row in the profile's cordis.patch.yml.
 * @module @deepseek-ai/dsh-client-ui-live2d-avatar/pet-settings
 */

/** Settings namespace (profile entry id) owning the pet preference. */
export const PET_SETTINGS_NAMESPACE = 'ui-live2d-avatar'

/** The only pet preference field: whether the pet floats in the client. */
export const PET_VISIBLE_FIELD = 'visible'

/** Preference value before the user has toggled the pet. */
export const PET_VISIBLE_DEFAULT = true

/** Resolved pet preference values as the settings form serves them. */
export interface PetSettings {
  /** Whether the pet floats in the client. */
  visible: boolean
}
