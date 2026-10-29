import { describe, expect, it, vi, type Mock } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryEntry, MemoryId, MemorySnapshot } from '@deepseek-ai/dsh-memory/types'
import { MemorySectionController } from '../src/client/controller.ts'

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return { enabled: true, consented: true, entries: [], ...overrides }
}

function entry(id = 'mem-1', text = '喜欢草莓'): MemoryEntry {
  return {
    id: id as MemoryId,
    text,
    kind: 'preference',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  }
}

function ok<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function fail(message = 'memory unavailable') {
  return Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', message, {}) })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

interface MemoryRemoteApi {
  snapshot: () => Promise<RemoteResult<MemorySnapshot>>
  setConsent: (consented: boolean) => Promise<RemoteResult<MemorySnapshot>>
  setEnabled: (enabled: boolean) => Promise<RemoteResult<MemorySnapshot>>
  save: (input: { text: string; kind: string }) => Promise<RemoteResult<MemoryEntry>>
  update: (id: MemoryId, text: string) => Promise<RemoteResult<MemoryEntry>>
  forget: (id: MemoryId) => Promise<RemoteResult<boolean>>
  clear: () => Promise<RemoteResult<MemorySnapshot>>
}

type MemoryRemoteMock = { [K in keyof MemoryRemoteApi]: Mock<MemoryRemoteApi[K]> }

function api(): MemoryRemoteMock {
  return {
    snapshot: vi.fn<MemoryRemoteApi['snapshot']>(() => ok(snapshot())),
    setConsent: vi.fn<MemoryRemoteApi['setConsent']>(() => ok(snapshot({ enabled: false, consented: true }))),
    setEnabled: vi.fn<MemoryRemoteApi['setEnabled']>(enabled => ok(snapshot({ enabled }))),
    save: vi.fn<MemoryRemoteApi['save']>(() => ok(entry())),
    update: vi.fn<MemoryRemoteApi['update']>(() => ok(entry())),
    forget: vi.fn<MemoryRemoteApi['forget']>(() => ok(true)),
    clear: vi.fn<MemoryRemoteApi['clear']>(() => ok(snapshot({ entries: [] }))),
  }
}

function controller(memory = api()) {
  const ctx = { remote: { memory } } as never
  return { controller: new MemorySectionController(ctx), memory }
}

describe('MemorySectionController', () => {
  it('loads the authoritative snapshot into a ready page', async () => {
    const memory = api()
    const view = controller(memory)
    const loading = view.controller.load()
    expect(view.controller.store.getSnapshot()).toMatchObject({ status: 'loading', error: null })
    await loading
    expect(memory.snapshot).toHaveBeenCalledTimes(1)
    expect(view.controller.store.getSnapshot()).toMatchObject({
      status: 'ready', enabled: true, consented: true, entries: [], error: null, busy: false,
    })
  })

  it('shares one in-flight read and reports a failed read', async () => {
    const memory = api()
    const pending = deferred<Awaited<ReturnType<typeof ok<MemorySnapshot>>>>()
    memory.snapshot.mockReturnValueOnce(pending.promise)
    const { controller: view } = controller(memory)
    const first = view.load()
    const second = view.load()
    expect(memory.snapshot).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, value: snapshot({ enabled: false, consented: false }) })
    await Promise.all([first, second])
    expect(view.store.getSnapshot()).toMatchObject({ status: 'ready', enabled: false, consented: false })

    memory.snapshot.mockResolvedValueOnce(await fail('read failed'))
    await view.load()
    expect(view.store.getSnapshot()).toMatchObject({ status: 'error', error: 'read failed' })
  })

  it('records consent then enables memory in one action', async () => {
    const { controller: view, memory } = controller()
    await expect(view.consent()).resolves.toBe(true)
    expect(memory.setConsent).toHaveBeenCalledWith(true)
    expect(memory.setEnabled).toHaveBeenCalledWith(true)
    expect(view.store.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, consented: true, busy: false })
  })

  it('stops consent at the first failed write and surfaces the message', async () => {
    const memory = api()
    memory.setConsent.mockReturnValueOnce(fail('consent refused'))
    const { controller: view } = controller(memory)
    await expect(view.consent()).resolves.toBe(false)
    expect(memory.setEnabled).not.toHaveBeenCalled()
    expect(view.store.getSnapshot()).toMatchObject({ error: 'consent refused', busy: false })

    memory.setConsent.mockReturnValueOnce(ok(snapshot({ enabled: false, consented: true })))
    memory.setEnabled.mockReturnValueOnce(fail('enable refused'))
    await expect(view.consent()).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('enable refused')
  })

  it('enables and disables memory from the returned snapshot', async () => {
    const { controller: view, memory } = controller()
    await expect(view.setEnabled(false)).resolves.toBe(true)
    expect(view.store.getSnapshot().enabled).toBe(false)

    memory.setEnabled.mockReturnValueOnce(fail('toggle refused'))
    await expect(view.setEnabled(true)).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('toggle refused')
  })

  it('saves and refreshes, staying on the current list when the save fails', async () => {
    const { controller: view, memory } = controller()
    await view.load()
    memory.snapshot.mockReturnValueOnce(ok(snapshot({ entries: [entry()] })))
    await expect(view.save('喜欢草莓', 'preference')).resolves.toBe(true)
    expect(memory.save).toHaveBeenCalledWith({ text: '喜欢草莓', kind: 'preference' })
    expect(view.store.getSnapshot().entries).toHaveLength(1)

    memory.save.mockReturnValueOnce(fail('save refused'))
    await expect(view.save('别的', 'fact')).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('save refused')
  })

  it('reports a failed refresh after a successful save', async () => {
    const { controller: view, memory } = controller()
    memory.snapshot.mockReturnValueOnce(fail('refresh failed'))
    await expect(view.save('喜欢草莓', 'preference')).resolves.toBe(false)
    expect(memory.save).toHaveBeenCalledOnce()
    expect(view.store.getSnapshot()).toMatchObject({ error: 'refresh failed', busy: false })
  })

  it('updates an entry and refreshes the list', async () => {
    const { controller: view, memory } = controller()
    memory.snapshot.mockReturnValueOnce(ok(snapshot({ entries: [entry('mem-1', 'edited')] })))
    await expect(view.update('mem-1' as MemoryId, 'edited')).resolves.toBe(true)
    expect(memory.update).toHaveBeenCalledWith('mem-1', 'edited')
    expect(view.store.getSnapshot().entries[0]?.text).toBe('edited')

    memory.update.mockReturnValueOnce(fail('update refused'))
    await expect(view.update('mem-1' as MemoryId, 'no')).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('update refused')
  })

  it('forgets an entry and reports a failed delete', async () => {
    const { controller: view, memory } = controller()
    await expect(view.forget('mem-1' as MemoryId)).resolves.toBe(true)
    expect(memory.forget).toHaveBeenCalledWith('mem-1')

    memory.forget.mockReturnValueOnce(fail('delete refused'))
    await expect(view.forget('mem-2' as MemoryId)).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('delete refused')
  })

  it('clears every entry from the returned snapshot', async () => {
    const { controller: view, memory } = controller()
    memory.snapshot.mockReturnValueOnce(ok(snapshot({ entries: [entry()] })))
    await view.load()
    await expect(view.clear()).resolves.toBe(true)
    expect(view.store.getSnapshot().entries).toEqual([])

    memory.clear.mockReturnValueOnce(fail('clear refused'))
    await expect(view.clear()).resolves.toBe(false)
    expect(view.store.getSnapshot().error).toBe('clear refused')
  })

  it('serializes mutations in call order', async () => {
    const { controller: view, memory } = controller()
    const first = deferred<Awaited<ReturnType<typeof ok<MemoryEntry>>>>()
    const second = deferred<Awaited<ReturnType<typeof ok<MemoryEntry>>>>()
    memory.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const one = view.save('first', 'fact')
    const two = view.save('second', 'fact')
    await Promise.resolve()
    expect(memory.save).toHaveBeenCalledTimes(1)
    first.resolve({ ok: true, value: entry('mem-1', 'first') })
    await expect(one).resolves.toBe(true)
    await Promise.resolve()
    expect(memory.save).toHaveBeenCalledTimes(2)
    second.resolve({ ok: true, value: entry('mem-2', 'second') })
    await expect(two).resolves.toBe(true)
    expect(view.store.getSnapshot().busy).toBe(false)
  })

  it('turns a non-Error rejection into visible text and returns busy to false', async () => {
    const memory = api()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- non-Error Remote rejection is the scenario.
    memory.setEnabled.mockReturnValueOnce(Promise.reject('plain failure'))
    const { controller: view } = controller(memory)
    await expect(view.setEnabled(false)).resolves.toBe(false)
    expect(view.store.getSnapshot()).toMatchObject({ error: 'plain failure', busy: false })
  })
})
