/**
 * General Settings row for the desktop pet: the visibility switch plus the
 * size, opacity, and dock-corner segmented controls, backed by the plugin's
 * own settings namespace. Registered by this package — the pet feature owns
 * its own settings surface.
 */
import { Switch, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  PET_ANCHOR_FIELD, PET_HEIGHT_FIELD, PET_OPACITY_FIELD, PET_VISIBLE_FIELD,
  type PetAnchor, type PetSettings,
} from '../pet-settings.ts'
import css from './PetRow.module.css'

/** Registration-side pet preferences. */
export interface PetRowInjected {
  hooks: {
    /** Current preferences, bound as useSettings. */
    settings: ObservableSnapshot<PetSettings>
  }
  /** Write one preference field (persisted through the settings service). */
  setField: (field: string, value: unknown) => void
}

/** Full Settings-row props. */
export type PetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.live2dAvatar'>
  & InjectFace<PetRowInjected>

/** Size presets the segmented control offers, in pixels of pet height. */
const SIZE_PRESETS = { small: 200, standard: 300, large: 400 } as const
/** Opacity presets the segmented control offers. */
const OPACITY_PRESETS = { opaque: 1, translucent: 0.65, faint: 0.4 } as const

/** The preset key whose value sits nearest to the current one. */
function nearestKey<V extends string>(presets: Record<V, number>, value: number): V {
  let best = Object.keys(presets)[0] as V
  for (const key of Object.keys(presets) as V[]) {
    if (Math.abs(presets[key] - value) < Math.abs(presets[best] - value)) best = key
  }
  return best
}

/**
 * Render the desktop-pet settings row.
 * @param props - composed Settings slot props.
 * @returns the settings row.
 */
export function PetRow({ useSettings, setField, t }: PetRowProps) {
  const settings = useSettings(value => value)
  return (
    <div className={css.row}>
      <div className={css.head}>
        <div>
          <div className={css.title}>{t('pet.title')}</div>
          <div className={css.description}>{t('pet.description')}</div>
        </div>
        <Switch checked={settings.visible} label={t('pet.title')} onChange={next => setField(PET_VISIBLE_FIELD, next)} />
      </div>
      <div className={css.controls}>
        <div className={css.field}>
          <span className={css.label}>{t('pet.size')}</span>
          <SegmentedControl
            id='live2d-pet-size' label={t('pet.size')}
            value={nearestKey(SIZE_PRESETS, settings.height)}
            options={[
              { value: 'small', label: t('pet.size.small') },
              { value: 'standard', label: t('pet.size.standard') },
              { value: 'large', label: t('pet.size.large') },
            ]}
            onChange={value => setField(PET_HEIGHT_FIELD, SIZE_PRESETS[value])}
          />
        </div>
        <div className={css.field}>
          <span className={css.label}>{t('pet.opacity')}</span>
          <SegmentedControl
            id='live2d-pet-opacity' label={t('pet.opacity')}
            value={nearestKey(OPACITY_PRESETS, settings.opacity)}
            options={[
              { value: 'opaque', label: t('pet.opacity.opaque') },
              { value: 'translucent', label: t('pet.opacity.translucent') },
              { value: 'faint', label: t('pet.opacity.faint') },
            ]}
            onChange={value => setField(PET_OPACITY_FIELD, OPACITY_PRESETS[value])}
          />
        </div>
        <div className={css.field}>
          <span className={css.label}>{t('pet.anchor')}</span>
          <SegmentedControl
            id='live2d-pet-anchor' label={t('pet.anchor')}
            value={settings.anchor}
            options={[
              { value: 'left', label: t('pet.anchor.left') },
              { value: 'right', label: t('pet.anchor.right') },
            ]}
            onChange={(value: PetAnchor) => setField(PET_ANCHOR_FIELD, value)}
          />
        </div>
      </div>
    </div>
  )
}
