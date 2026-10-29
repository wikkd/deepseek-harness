/**
 * Long-term memory settings page: first-run consent, one availability switch,
 * an explicit add form, and a view/edit/delete/clear list. Nothing here writes
 * without a user action; the Host service owns every durable rule.
 */

import { useEffect, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryId, MemoryKind } from '@deepseek-ai/dsh-memory/types'
import type { MemorySectionInjected } from './controller.ts'
import css from './MemorySection.module.css'

/** Every memory kind in display order. */
const KINDS: readonly MemoryKind[] = ['user', 'preference', 'fact']

/** Props the renderer binds for the memory settings section. */
export type MemorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.memory'>
  & InjectFace<MemorySectionInjected>

/**
 * Render the memory settings page.
 * @param props - page state, actions, and locale copy.
 * @returns the consent card, the switch and list, or a loading/error state.
 */
export function MemorySection(props: MemorySectionProps) {
  const { t, load, consent, setEnabled, save, update, forget, clear } = props
  const state = props.useMemory(snapshot => snapshot)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<MemoryKind>('user')
  const [editing, setEditing] = useState<{ id: MemoryId; text: string } | null>(null)
  const [clearArmed, setClearArmed] = useState(false)

  useEffect(() => { void load() }, [load])

  const kindLabel = (value: MemoryKind): string => t(
    value === 'user' ? 'kindUser' : value === 'preference' ? 'kindPreference' : 'kindFact',
  )
  const busy = state.busy

  const submitNew = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    if (text.length === 0) return
    if (await save(text, kind)) setDraft('')
  }
  const submitEdit = async (id: MemoryId, text: string): Promise<void> => {
    if (await update(id, text)) setEditing(null)
  }
  const remove = async (id: MemoryId): Promise<void> => {
    if (await forget(id)) setEditing(null)
  }
  const clearAll = async (): Promise<void> => {
    if (await clear()) setClearArmed(false)
  }

  return (
    <section className={css.section} aria-labelledby="settings-memory-title">
      <div className={css.heading}>
        <h2 id="settings-memory-title" className={css.title}>{t('title')}</h2>
        <p className={css.description}>{t('description')}</p>
      </div>

      {state.error !== null && <p role="alert" className={css.error}>{state.error}</p>}

      {(state.status === 'idle' || state.status === 'loading') && (
        <p className={css.muted}>{t('loading')}</p>
      )}

      {state.status === 'error' && (
        <Button onClick={() => { void load() }}>{t('retry')}</Button>
      )}

      {state.status === 'ready' && !state.consented && (
        <div className={css.card}>
          <h3 className={css.cardTitle}>{t('consentTitle')}</h3>
          <p className={css.cardBody}>{t('consentBody')}</p>
          <Button variant="primary" disabled={busy} onClick={() => { void consent() }}>
            {t('consentAction')}
          </Button>
        </div>
      )}

      {state.status === 'ready' && state.consented && (
        <>
          <div className={css.switchRow}>
            <div className={css.switchCopy}>
              <div className={css.switchTitle}>{t('enabledLabel')}</div>
              <p className={css.hint}>{state.enabled ? t('enabledHint') : t('disabledHint')}</p>
            </div>
            <Switch
              checked={state.enabled}
              label={t('enabledLabel')}
              disabled={busy}
              onChange={(next) => { void setEnabled(next) }}
            />
          </div>

          {state.enabled && (
            <form className={css.form} onSubmit={(event) => { void submitNew(event) }}>
              <Input
                className={clsx(css.input)}
                value={draft}
                aria-label={t('addPlaceholder')}
                placeholder={t('addPlaceholder')}
                disabled={busy}
                onChange={(event) => { setDraft(event.target.value) }}
              />
              <select
                className={css.select}
                value={kind}
                aria-label={t('kindLabel')}
                disabled={busy}
                onChange={(event) => { setKind(event.target.value as MemoryKind) }}
              >
                {KINDS.map(value => <option key={value} value={value}>{kindLabel(value)}</option>)}
              </select>
              <Button variant="primary" type="submit" disabled={busy || draft.trim().length === 0}>
                {t('add')}
              </Button>
            </form>
          )}

          <div className={css.list}>
            {state.entries.length === 0 && <p className={css.muted}>{t('empty')}</p>}
            {state.entries.map(entry => (
              <div key={entry.id} className={css.entry}>
                {editing?.id === entry.id ? (
                  <div className={css.editRow}>
                    <Input
                      className={clsx(css.input)}
                      value={editing.text}
                      aria-label={t('editText')}
                      disabled={busy}
                      onChange={(event) => {
                        setEditing({ id: entry.id, text: event.target.value })
                      }}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || editing.text.trim().length === 0}
                      onClick={() => { void submitEdit(entry.id, editing.text) }}
                    >
                      {t('save')}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => { setEditing(null) }}>
                      {t('cancel')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className={css.entryBody}>
                      <span className={css.kind}>{kindLabel(entry.kind)}</span>
                      <span className={css.entryText}>{entry.text}</span>
                    </div>
                    <div className={css.actions}>
                      <Button
                        size="sm"
                        disabled={busy}
                        aria-label={`${t('edit')}: ${entry.text}`}
                        onClick={() => { setEditing({ id: entry.id, text: entry.text }) }}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        size="sm"
                        className={css.danger}
                        disabled={busy}
                        aria-label={`${t('delete')}: ${entry.text}`}
                        onClick={() => { void remove(entry.id) }}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {state.entries.length > 0 && (
            <div className={css.clearRow}>
              {clearArmed ? (
                <>
                  <span className={css.hint}>{t('clearConfirmHint')}</span>
                  <Button size="sm" className={css.danger} disabled={busy} onClick={() => { void clearAll() }}>
                    {t('clearConfirm')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => { setClearArmed(false) }}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" className={css.danger} disabled={busy} onClick={() => { setClearArmed(true) }}>
                  {t('clear')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
