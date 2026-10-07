/**
 * The agent-preset quick-select row on the new-session screen, beside the
 * workspace picker.
 *
 * It lives here rather than in the composer because the choice is only
 * available before a conversation starts: once a turn has run, the session's
 * history was produced under that preset's tools and the host refuses to swap
 * them. A control that spends most of its life disabled belongs on the screen
 * where it still works.
 *
 * Every choosable preset renders as its own pill, so the roster is visible at
 * a glance and a pick is one click. The pill for the preset the session is
 * about to run stays visible even when it is filtered out of the choosable
 * set (Developer tools off) — a disabled, pressed pill — because the user
 * must always see what the next session will run.
 *
 * The row reflects the staged choice, which starts as the deployment default.
 * Picking stages; the choice reaches a session when one becomes current.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { presetDisplayText } from './locales.ts'
import { requiresCodingTools } from './settings-store.ts'
import css from './AgentPresetSeat.module.css'

/** Registration-side business face for the hero row. */
export interface AgentPresetSeatInjected {
  hooks: {
    /** Shared Developer tools preference; off hides the PTC and Minimal pills. */
    developerTools: ObservableSnapshot<boolean>
    /** Row snapshot bound by the renderer as useAgentPresetSeat. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster when the row first renders. */
  load: () => Promise<void>
  /** Stage one preset for the next session; resolves to a refusal, or undefined. */
  select: (id: string) => Promise<string | undefined>
  /** Acknowledge the refusal whose Toast finished. */
  dismissRefusal: (error: AgentPresetSeatState['error']) => void
  /** Clear the one-shot introduce cue once the row has played it. */
  introduced: () => void
}

/* Introduce timeline: the name's characters of the selected pill start fading
   up, each taking the fade duration to settle. The cue clears after the last
   one. The stagger is capped twice: per tick for short CJK names, and by one
   shared reveal window so a long Latin name finishes in the same time as its
   CJK counterpart instead of dragging the run out per character. */
const INTRO_TEXT_DELAY_MS = 150
const INTRO_CHAR_STAGGER_MS = 40
const INTRO_TEXT_REVEAL_MS = 200
const INTRO_CHAR_FADE_MS = 400

/** Duration of a selection-refusal banner, including a revision becoming unavailable during a pick. */
const REFUSAL_HOLD_MS = 8000

/**
 * Per-character start offset for the introduce reveal.
 * @param count - character count of the shown preset name.
 * @returns milliseconds between successive character starts.
 */
function introStaggerMs(count: number): number {
  if (count <= 1) return 0
  return Math.min(INTRO_CHAR_STAGGER_MS, INTRO_TEXT_REVEAL_MS / (count - 1))
}

/** Full component props. */
export type AgentPresetSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSeatInjected>

/**
 * Render the new-session agent-preset quick-select row.
 * @param props - composed slot props.
 * @returns The pill row and any pending selection refusal, or null outside the main view.
 */
export function AgentPresetSeat({
  sessionId, useSessionRetainInfo, load, select, dismissRefusal, introduced, useAgentPresetSeat, useDeveloperTools, t,
}: AgentPresetSeatProps) {
  const developerTools = useDeveloperTools(value => value)
  const state = useAgentPresetSeat(snapshot => snapshot)
  const main = useSessionRetainInfo(info => sessionId === undefined
    || (info?.retainedBy.mainView ?? 0) > 0)
  // The seq keys the banner, so picking the same broken preset twice replays
  // it rather than leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; error: Exclude<AgentPresetSeatState['error'], string | null> } | null>(null)

  useEffect(() => {
    if (state.error !== null && typeof state.error === 'object') {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, error: state.error })
    } else setToast(null)
  }, [state.error])

  useEffect(() => {
    void load()
  }, [load])

  const choosable = useMemo(
    () => state.options.filter(option => developerTools || !requiresCodingTools(option)),
    [state.options, developerTools],
  )

  const chosen = state.options.find(option => option.id === state.current)
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  const label = chosenText?.name ?? state.current
  const ready = state.options.length > 0 && state.current !== ''

  // The introduce cue: the pick was staged from another screen (the settings
  // creator entry), so the selected pill announces it — each character of the
  // name fades up on a stagger (CSS owns the motion; this effect only arms it
  // and acknowledges the cue once the run is over).
  const [introducing, setIntroducing] = useState(false)
  useEffect(() => {
    if (!state.introduce || !ready) return
    const characters = Array.from(label)
    if (characters.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introduced()
      return
    }
    setIntroducing(true)
    const done = window.setTimeout(() => {
      setIntroducing(false)
      introduced()
    }, INTRO_TEXT_DELAY_MS + (characters.length - 1) * introStaggerMs(characters.length) + INTRO_CHAR_FADE_MS)
    return () => { window.clearTimeout(done) }
  }, [state.introduce, ready, label, introduced])

  // A refused initial composition still needs its Toast when there is no row to show.
  if (!main) return null

  // The pills on offer, plus the preset the next session already carries when
  // it is filtered out of the choosable set: what will run must stay visible
  // even when it can no longer be chosen.
  const currentHidden = state.current !== '' && !choosable.some(option => option.id === state.current)
  const displayed = currentHidden
    ? [...choosable, chosen ?? { id: state.current }]
    : choosable

  // One wrapper span per run: the pill is a flex row, so loose character
  // spans would each pick up the gap between them.
  const characters = Array.from(label)
  const stagger = introStaggerMs(characters.length)
  const refusal = typeof state.error === 'object' ? state.error?.reason : state.error

  return (
    <>
      {ready && (
        <div role="group" aria-label={t('seatHint')} title={refusal ?? undefined} className={css.group}>
          {displayed.map((option) => {
            const text = presetDisplayText(option, t)
            const selected = option.id === state.current
            const name = text.name
            return (
              <button
                key={option.id}
                type="button"
                className={css.pill}
                aria-pressed={selected}
                // Name and description together: the id alone never says what
                // a preset does, which is why the roster carries display copy.
                title={text.description ?? t('noDescription')}
                disabled={state.busy || !choosable.some(choosableOption => choosableOption.id === option.id)}
                onClick={() => { void select(option.id) }}
              >
                {selected && introducing
                  ? (
                    <span className={css.introText}>
                      {characters.map((character, index) => (
                        <span
                          key={index}
                          className={css.introChar}
                          style={{ animationDelay: `${INTRO_TEXT_DELAY_MS + index * stagger}ms` }}
                        >
                          {character}
                        </span>
                      ))}
                    </span>
                  )
                  : <span className={css.pillLabel}>{name}</span>}
              </button>
            )
          })}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={t('switchRefused', { name: presetDisplayText(toast.error.preset, t).name, reason: toast.error.reason })}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which is the content column this row sits
          // above rather than inside — hence a page query, not `closest`.
          // Absent, the banner centers on the window, which is off-center
          // whenever the sidebar is open.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { dismissRefusal(toast.error) }}
        />
      )}
    </>
  )
}
