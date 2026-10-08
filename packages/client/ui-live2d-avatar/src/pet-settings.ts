/**
 * The desktop pet's user preferences, shared by both plugin halves: the host
 * half declares the schema, the browser half reads and writes them through the
 * settings service. The namespace is the profile entry id the settings forms
 * address, so it must match the plugin row in the profile's cordis.patch.yml.
 * @module @deepseek-ai/dsh-client-ui-live2d-avatar/pet-settings
 */

/** Settings namespace (profile entry id) owning the pet preferences. */
export const PET_SETTINGS_NAMESPACE = 'ui-live2d-avatar'

/** Whether the pet floats in the client. */
export const PET_VISIBLE_FIELD = 'visible'
/** Displayed pet height in pixels; the mascot hugs the viewport bottom edge. */
export const PET_HEIGHT_FIELD = 'height'
/** How see-through the pet renders, 0..1 where 1 is fully opaque. */
export const PET_OPACITY_FIELD = 'opacity'
/** Which lower corner the pet docks to before the user drags it. */
export const PET_ANCHOR_FIELD = 'anchor'

/** Preference values before the user has touched the pet. */
export const PET_VISIBLE_DEFAULT = true
export const PET_HEIGHT_DEFAULT = 300
export const PET_HEIGHT_MIN = 160
export const PET_HEIGHT_MAX = 480
export const PET_OPACITY_DEFAULT = 1
export const PET_OPACITY_MIN = 0.2
export const PET_ANCHOR_DEFAULT = 'right'

/** One dock side. */
export type PetAnchor = 'left' | 'right'

/** Resolved pet preferences as the settings form serves them. */
export interface PetSettings {
  /** Whether the pet floats in the client. */
  visible: boolean
  /** Displayed pet height in pixels. */
  height: number
  /** How see-through the pet renders, 0..1 where 1 is fully opaque. */
  opacity: number
  /** Which lower corner the pet docks to. */
  anchor: PetAnchor
}

/** The preference values used before the first settings acceptance lands. */
export const PET_SETTINGS_DEFAULTS: PetSettings = {
  visible: PET_VISIBLE_DEFAULT,
  height: PET_HEIGHT_DEFAULT,
  opacity: PET_OPACITY_DEFAULT,
  anchor: PET_ANCHOR_DEFAULT,
}
