/**
 * General Settings row for the desktop pet: a switch toggling the pet's
 * visibility, backed by the plugin's own settings namespace. Registered by
 * this package — the pet feature owns its own settings surface.
 */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './PetRow.module.css'

/** Registration-side pet preference. */
export interface PetRowInjected {
  hooks: {
    /** Current visible preference, bound as useVisible. */
    visible: ObservableSnapshot<boolean>
  }
  /** Show or hide the pet (persisted through the settings service). */
  setVisible: (visible: boolean) => void
}

/** Full Settings-row props. */
export type PetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.live2dAvatar'>
  & InjectFace<PetRowInjected>

/**
 * Render the desktop-pet toggle row.
 * @param props - composed Settings slot props.
 * @returns the settings row.
 */
export function PetRow({ useVisible, setVisible, t }: PetRowProps) {
  const visible = useVisible(value => value)
  return (
    <div className={css.row}>
      <div>
        <div className={css.title}>{t('pet.title')}</div>
        <div className={css.description}>{t('pet.description')}</div>
      </div>
      <Switch checked={visible} label={t('pet.title')} onChange={setVisible} />
    </div>
  )
}
