import { useEffect } from 'react'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft persisted while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  view, useSession, useConversation, useConversationViews, inputActions, useStore, actions,
  renderSlot, bindDraftPersistence, openView, useInspectCall,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const inspectCall = useInspectCall(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  // The blank check narrows both snapshots to booleans (the same fields
  // conversationPhase reads): streaming chunk updates flip none of them, so
  // this skeleton layer stops re-rendering per chunk while a turn streams.
  const blank = useSession(s => s.blank)
  const running = useSession(s => s.running)
  const promptAttempted = useSession(s => s.promptAttempted)
  const liveTargets = useConversation(s => s.activeTargets.size > 0)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    const unbindDraftPersistence = bindDraftPersistence(actions.setDraft)
    inputActions.persistDraft()
    return () => { unbindDraftPersistence() }
    // The Session input owns content before this persistence writer is attached.
  }, [inputActions])

  // `session.blank && conversationPhase(session, conversation) === 'blank'`,
  // with conversationPhase's definition folded over the narrowed booleans.
  if (blank && !liveTargets && !running && !promptAttempted) return null
  const viewId = view ?? active?.id
  return (
    <div className={css.viewArea}>
      {viewId !== undefined && renderSlot('conversation.view', {
        inspectCall,
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: viewId })}
    </div>
  )
}
