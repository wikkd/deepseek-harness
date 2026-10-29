// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MemoryEntry, MemoryId } from '@deepseek-ai/dsh-memory/types'
import { MemorySection, type MemorySectionProps } from '../src/client/MemorySection.tsx'
import type { MemorySectionState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const READY: MemorySectionState = {
  status: 'ready',
  error: null,
  busy: false,
  enabled: true,
  consented: true,
  entries: [],
}

function entry(id: string, text: string, kind: MemoryEntry['kind'] = 'fact'): MemoryEntry {
  return {
    id: id as MemoryId,
    text,
    kind,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  }
}

/** Standard framework seats this section never reads. */
function unusedStandard(): never {
  throw new Error('unused standard prop')
}

const t: MemorySectionProps['t'] = makeTranslate(en)

function view(patch: Partial<MemorySectionState> = {}, overrides: Partial<MemorySectionProps> = {}) {
  const store = createSnapshotStore<MemorySectionState>({ ...READY, ...patch })
  const actions = {
    load: vi.fn(async () => {}),
    consent: vi.fn(async () => true),
    setEnabled: vi.fn(async () => true),
    save: vi.fn(async () => true),
    update: vi.fn(async () => true),
    forget: vi.fn(async () => true),
    clear: vi.fn(async () => true),
  }
  const props: MemorySectionProps = {
    close: vi.fn(),
    ...actions,
    useMemory: bindSnapshotSelector(store),
    usePanelInfo: unusedStandard,
    useResource: unusedStandard,
    useSessions: unusedStandard,
    useSessionStatus: unusedStandard,
    useSessionRetainInfo: unusedStandard,
    useWorkspaces: unusedStandard,
    t,
    ...overrides,
  }
  const rendered = render(<MemorySection {...props} />)
  return { ...actions, store, props, rerender: () => { rendered.rerender(<MemorySection {...props} />) } }
}

describe('MemorySection', () => {
  it('shows the loading state and reads memory once on mount', async () => {
    const actions = view({ status: 'idle' })
    expect(screen.getByText(en.loading)).toBeTruthy()
    await waitFor(() => { expect(actions.load).toHaveBeenCalledOnce() })
    act(() => { actions.store.set({ ...actions.store.getSnapshot(), status: 'ready' }) })
    expect(screen.queryByText(en.loading)).toBeNull()
  })

  it('shows the first-run consent card and records consent', async () => {
    const actions = view({ consented: false, enabled: false })
    expect(screen.getByRole('heading', { name: en.consentTitle })).toBeTruthy()
    expect(screen.getByText(en.consentBody)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.consentAction }))
    await waitFor(() => { expect(actions.consent).toHaveBeenCalledOnce() })
  })

  it('shows a failed read with the message and a retry action', async () => {
    const actions = view({ status: 'error', error: 'read failed' })
    expect(screen.getByRole('alert').textContent).toBe('read failed')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(2) })
  })

  it('keeps a ready-page error visible and renders every entry kind', async () => {
    view({
      error: 'a later failure',
      entries: [entry('mem-1', 'about me', 'user'), entry('mem-2', 'likes tea', 'preference'), entry('mem-3', 'lives here')],
    })
    expect(screen.getByRole('alert').textContent).toBe('a later failure')
    expect(screen.getAllByText(en.kindUser).some(node => node.tagName === 'SPAN')).toBe(true)
    expect(screen.getAllByText(en.kindPreference).some(node => node.tagName === 'SPAN')).toBe(true)
    expect(screen.getAllByText(en.kindFact).some(node => node.tagName === 'SPAN')).toBe(true)
    expect(screen.getByText('about me')).toBeTruthy()
    expect(screen.getByText('likes tea')).toBeTruthy()
    expect(screen.getByText('lives here')).toBeTruthy()
  })

  it('shows the switch, empty state, and saves a trimmed new entry', async () => {
    const actions = view()
    expect(screen.getByRole('switch', { name: en.enabledLabel }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.empty)).toBeTruthy()
    const input = screen.getByPlaceholderText(en.addPlaceholder) as HTMLInputElement
    const select = screen.getByRole('combobox', { name: en.kindLabel }) as HTMLSelectElement
    const form = input.closest('form')
    expect(form).not.toBeNull()

    fireEvent.change(input, { target: { value: '  喜欢草莓  ' } })
    fireEvent.change(select, { target: { value: 'preference' } })
    fireEvent.click(within(form!).getByRole('button', { name: en.add }))
    await waitFor(() => { expect(actions.save).toHaveBeenCalledWith('喜欢草莓', 'preference') })
    await waitFor(() => { expect(input.value).toBe('') })
  })

  it('does not save a blank draft and keeps the draft after a failed save', async () => {
    const actions = view()
    const input = screen.getByPlaceholderText(en.addPlaceholder) as HTMLInputElement
    const form = input.closest('form')!
    const add = within(form).getByRole('button', { name: en.add }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.submit(form)
    expect(actions.save).not.toHaveBeenCalled()

    actions.save.mockResolvedValueOnce(false)
    fireEvent.change(input, { target: { value: 'keep me' } })
    fireEvent.click(add)
    await waitFor(() => { expect(actions.save).toHaveBeenCalledWith('keep me', 'user') })
    expect(input.value).toBe('keep me')
  })

  it('hides the add form while memory is off but keeps entries viewable', async () => {
    const actions = view({ enabled: false, entries: [entry('mem-1', 'kept')] })
    expect(screen.queryByPlaceholderText(en.addPlaceholder)).toBeNull()
    expect(screen.getByText('kept')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: en.enabledLabel })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => { expect(actions.setEnabled).toHaveBeenCalledWith(true) })
  })

  it('edits an entry, saves it, and cancels a later edit', async () => {
    const actions = view({ entries: [entry('mem-1', 'old text')] })
    fireEvent.click(screen.getByRole('button', { name: `${en.edit}: old text` }))
    const input = screen.getByRole('textbox', { name: en.editText }) as HTMLInputElement
    const editRow = input.closest('div')!
    fireEvent.change(input, { target: { value: 'new text' } })
    fireEvent.click(within(editRow).getByRole('button', { name: en.save }))
    await waitFor(() => { expect(actions.update).toHaveBeenCalledWith('mem-1', 'new text') })
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: en.editText })).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: `${en.edit}: old text` }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('textbox', { name: en.editText })).toBeNull()
  })

  it('keeps the editor open and disables save when the edit is blank or fails', async () => {
    const actions = view({ entries: [entry('mem-1', 'old text')] })
    fireEvent.click(screen.getByRole('button', { name: `${en.edit}: old text` }))
    const input = screen.getByRole('textbox', { name: en.editText }) as HTMLInputElement
    const save = within(input.closest('div')!).getByRole('button', { name: en.save }) as HTMLButtonElement
    fireEvent.change(input, { target: { value: '   ' } })
    expect(save.disabled).toBe(true)

    actions.update.mockResolvedValueOnce(false)
    fireEvent.change(input, { target: { value: 'new text' } })
    fireEvent.click(save)
    await waitFor(() => { expect(actions.update).toHaveBeenCalledWith('mem-1', 'new text') })
    expect(screen.getByRole('textbox', { name: en.editText })).toBeTruthy()
  })

  it('deletes an entry and keeps the list when the delete fails', async () => {
    const actions = view({ entries: [entry('mem-1', 'remove me')] })
    actions.forget.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: `${en.delete}: remove me` }))
    await waitFor(() => { expect(actions.forget).toHaveBeenCalledWith('mem-1') })
    expect(screen.getByText('remove me')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `${en.delete}: remove me` }))
    await waitFor(() => { expect(actions.forget).toHaveBeenCalledTimes(2) })
  })

  it('asks before clearing everything and can be cancelled', async () => {
    const actions = view({ entries: [entry('mem-1', 'one')] })
    fireEvent.click(screen.getByRole('button', { name: en.clear }))
    expect(screen.getByText(en.clearConfirmHint)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(actions.clear).not.toHaveBeenCalled()
    expect(screen.queryByText(en.clearConfirmHint)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.clear }))
    fireEvent.click(screen.getByRole('button', { name: en.clearConfirm }))
    await waitFor(() => { expect(actions.clear).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByText(en.clearConfirmHint)).toBeNull() })
  })

  it('keeps the clear confirmation when clearing fails', async () => {
    const actions = view({ entries: [entry('mem-1', 'one')] })
    actions.clear.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: en.clear }))
    fireEvent.click(screen.getByRole('button', { name: en.clearConfirm }))
    await waitFor(() => { expect(actions.clear).toHaveBeenCalledOnce() })
    expect(screen.getByText(en.clearConfirmHint)).toBeTruthy()
  })

  it('disables every mutation control while a write is in flight', () => {
    view({ busy: true, entries: [entry('mem-1', 'busy')] })
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.enabledLabel }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: `${en.edit}: busy` }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: `${en.delete}: busy` }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.clear }).disabled).toBe(true)
    expect(screen.getByPlaceholderText<HTMLInputElement>(en.addPlaceholder).disabled).toBe(true)
  })

  it('does not read again on a re-render with the same action', async () => {
    const actions = view()
    await waitFor(() => { expect(actions.load).toHaveBeenCalledOnce() })
    actions.rerender()
    expect(actions.load).toHaveBeenCalledOnce()
  })
})
