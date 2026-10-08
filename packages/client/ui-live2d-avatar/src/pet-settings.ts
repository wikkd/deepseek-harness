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
/** How often the pet changes its ambient motion while idle. */
export const PET_MOTION_RATE_FIELD = 'motionRate'
/** Whether the pet's mouth follows the spoken replies. */
export const PET_LIP_SYNC_FIELD = 'lipSync'
/** Whether the pet swaps its expression with each reply's classified emotion. */
export const PET_EMOTION_FIELD = 'emotionExpressions'

/** Preference values before the user has touched the pet. */
export const PET_VISIBLE_DEFAULT = true
export const PET_HEIGHT_DEFAULT = 300
export const PET_HEIGHT_MIN = 160
export const PET_HEIGHT_MAX = 480
export const PET_OPACITY_DEFAULT = 1
export const PET_OPACITY_MIN = 0.2
export const PET_ANCHOR_DEFAULT = 'right'
export const PET_MOTION_RATE_DEFAULT = 'normal'
export const PET_LIP_SYNC_DEFAULT = true
export const PET_EMOTION_DEFAULT = true

/** One ambient-motion tempo. */
export type PetMotionRate = 'calm' | 'normal' | 'lively'
/** One dock side. */
export type PetAnchor = 'left' | 'right'

/** Ambient interval in milliseconds per tempo. */
export const PET_MOTION_INTERVALS: Record<PetMotionRate, number> = {
  calm: 15_000,
  normal: 9_000,
  lively: 4_500,
}

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
  /** How often the pet changes its ambient motion while idle. */
  motionRate: PetMotionRate
  /** Whether the pet's mouth follows the spoken replies. */
  lipSync: boolean
  /** Whether the pet mirrors each reply's classified emotion as an expression. */
  emotionExpressions: boolean
}

/** The emotion keys the expression mapping addresses. */
export type PetEmotionKey = 'happy' | 'angry' | 'sad' | 'surprised' | 'neutral'

/**
 * Emotion key → model expression name. The names address the model's
 * `Expressions` array entries; `neutral` resolves to the model's default
 * expression, so it holds no file mapping.
 */
export const PET_EMOTION_EXPRESSIONS: Record<PetEmotionKey, string> = {
  happy: 'mtn_ex_010.exp3.json',
  angry: 'mtn_ex_040.exp3.json',
  sad: 'mtn_ex_030.exp3.json',
  surprised: 'mtn_ex_020.exp3.json',
  neutral: '',
}

/** The preference values used before the first settings acceptance lands. */
export const PET_SETTINGS_DEFAULTS: PetSettings = {
  visible: PET_VISIBLE_DEFAULT,
  height: PET_HEIGHT_DEFAULT,
  opacity: PET_OPACITY_DEFAULT,
  anchor: PET_ANCHOR_DEFAULT,
  motionRate: PET_MOTION_RATE_DEFAULT,
  lipSync: PET_LIP_SYNC_DEFAULT,
  emotionExpressions: PET_EMOTION_DEFAULT,
}
