import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, type Domain, type DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryKind, MemorySettings } from '@deepseek-ai/dsh-memory'
import MemoryLocalService, { type Config } from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

interface HarnessOptions {
  readonly pool?: MemoryMediaPool
  readonly config?: Config
}

/** Boot the real storage hub, domain facility, and local memory provider. */
async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const events: MemorySettings[] = []
  ctx.on('memory/settings-changed', (settings) => { events.push(settings) })
  const fiber = await ctx.plugin(MemoryLocalService, options.config ?? {})
  const service = ctx.memory as MemoryLocalService
  return { ctx, fiber, pool, service, events }
}

const dispose: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(dispose.splice(0).map(close => close()))
})

async function active(config: Config = {}) {
  const booted = await harness({ config })
  dispose.push(() => booted.fiber.dispose())
  await booted.service.setConsent(true)
  await booted.service.setEnabled(true)
  return booted
}

/** Open a real domain, then make its table lookup fail before the service consumes it. */
class BrokenTableFacility extends DomainFacility {
  readonly closeSpy = vi.fn<() => Promise<void>>()

  override async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    const domain = await super.open(spec)
    const close = domain.close.bind(domain)
    this.closeSpy.mockImplementation(close)
    Object.defineProperty(domain, 'close', { value: this.closeSpy })
    Object.defineProperty(domain, 'table', {
      value: () => { throw new Error('table failed') },
    })
    return domain
  }
}

describe('MemoryLocalService', () => {
  it('closes the opened domain when table setup fails', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const pool = new MemoryMediaPool()
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new BrokenTableFacility(ctx, { backend: 'memory', routes: {} })
    ctx.provide('storageDomain', facility)

    await expect(ctx.plugin(MemoryLocalService)).rejects.toThrow('table failed')
    expect(facility.closeSpy).toHaveBeenCalledOnce()
  })

  it('starts empty, disabled, and without consent', async () => {
    const { service, events } = await harness()
    const snapshot = service.snapshot()
    expect(snapshot.enabled).toBe(false)
    expect(snapshot.consented).toBe(false)
    expect(snapshot.entries).toEqual([])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.entries)).toBe(true)
    expect(events).toEqual([])
  })

  it('requires consent before enabling and emits every settings change', async () => {
    const { service, events } = await harness()
    await expect(service.setEnabled(true)).rejects.toMatchObject({ code: 'consent-required' })

    await service.setConsent(true)
    expect(service.consented).toBe(true)
    expect(service.enabled).toBe(false)

    const enabled = await service.setEnabled(true)
    expect(enabled.enabled).toBe(true)
    expect(events).toEqual([
      { enabled: false, consented: true },
      { enabled: true, consented: true },
    ])

    const disabled = await service.setEnabled(false)
    expect(disabled.enabled).toBe(false)
    expect(events.at(-1)).toEqual({ enabled: false, consented: true })
  })

  it('withdrawing consent also disables memory but keeps entries', async () => {
    const { service } = await active()
    const saved = await service.save({ text: '喜欢草莓', kind: 'preference' })
    const withdrawn = await service.setConsent(false)
    expect(withdrawn).toMatchObject({ enabled: false, consented: false })
    expect(withdrawn.entries.map(entry => entry.id)).toEqual([saved.id])
    await expect(service.setEnabled(true)).rejects.toMatchObject({ code: 'consent-required' })
  })

  it('trims text, deduplicates exact saves, and refreshes kind and timestamp', async () => {
    const { service } = await active()
    const first = await service.save({ text: '  喜欢草莓  ', kind: 'preference' })
    expect(first.text).toBe('喜欢草莓')
    expect(first.kind).toBe('preference')
    expect(first.id).toMatch(/^mem-/)
    expect(service.list()).toHaveLength(1)

    const duplicate = await service.save({ text: '喜欢草莓', kind: 'user' })
    expect(duplicate.id).toBe(first.id)
    expect(duplicate.kind).toBe('user')
    expect(duplicate.createdAt).toBe(first.createdAt)
    expect(duplicate.updatedAt >= first.updatedAt).toBe(true)
    expect(service.list()).toHaveLength(1)
  })

  it('orders entries newest-first, then by id', async () => {
    const { service } = await active()
    const first = await service.save({ text: 'first', kind: 'fact' })
    await new Promise(resolve => setTimeout(resolve, 3))
    const second = await service.save({ text: 'second', kind: 'fact' })
    expect(service.list().map(entry => entry.id)).toEqual([second.id, first.id])

    await new Promise(resolve => setTimeout(resolve, 3))
    await service.update(first.id, 'first edited')
    expect(service.list()[0]?.id).toBe(first.id)
  })

  it('breaks equal timestamps by id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T00:00:00.000Z'))
    try {
      const { service } = await active()
      await service.save({ text: 'first', kind: 'fact' })
      await service.save({ text: 'second', kind: 'fact' })
      const ids = service.list().map(entry => entry.id)
      expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects blank, oversized, disabled, and unknown-kind saves', async () => {
    const booted = await harness({ config: { maxEntryChars: 4 } })
    dispose.push(() => booted.fiber.dispose())
    const { service } = booted
    await expect(service.save({ text: 'x', kind: 'user' })).rejects.toMatchObject({ code: 'consent-required' })
    await service.setConsent(true)
    await expect(service.save({ text: 'x', kind: 'user' })).rejects.toMatchObject({ code: 'disabled' })
    await service.setEnabled(true)
    await expect(service.save({ text: '   ', kind: 'user' })).rejects.toMatchObject({ code: 'blank' })
    await expect(service.save({ text: '12345', kind: 'user' })).rejects.toMatchObject({ code: 'too-large' })
    await expect(service.save({ text: 'ok', kind: 'bogus' as MemoryKind })).rejects.toMatchObject({ code: 'invalid-kind' })
  })

  it('refuses a new entry at the configured cap but still refreshes a duplicate', async () => {
    const { service } = await active({ maxEntries: 1 })
    const saved = await service.save({ text: 'only', kind: 'fact' })
    await expect(service.save({ text: 'second', kind: 'fact' })).rejects.toMatchObject({ code: 'limit' })
    const duplicate = await service.save({ text: ' only ', kind: 'user' })
    expect(duplicate.id).toBe(saved.id)
    expect(duplicate.kind).toBe('user')
  })

  it('updates text in place and rejects a missing or duplicate target', async () => {
    const { service } = await active()
    const first = await service.save({ text: 'first', kind: 'fact' })
    const second = await service.save({ text: 'second', kind: 'fact' })

    const updated = await service.update(first.id, '  first edited  ')
    expect(updated.id).toBe(first.id)
    expect(updated.text).toBe('first edited')
    expect(updated.createdAt).toBe(first.createdAt)
    expect(service.list().find(entry => entry.id === first.id)?.text).toBe('first edited')

    await expect(service.update(first.id, 'second')).rejects.toMatchObject({ code: 'duplicate' })
    await expect(service.update(first.id, '   ')).rejects.toMatchObject({ code: 'blank' })
    await expect(service.update('mem-missing' as typeof first.id, 'third')).rejects.toMatchObject({ code: 'not-found' })
    expect(second.id).not.toBe(first.id)
  })

  it('forgets entries idempotently and clears every entry without changing settings', async () => {
    const { service } = await active()
    const first = await service.save({ text: 'first', kind: 'fact' })
    await service.save({ text: 'second', kind: 'fact' })

    await expect(service.forget(first.id)).resolves.toBe(true)
    await expect(service.forget(first.id)).resolves.toBe(false)
    expect(service.list()).toHaveLength(1)

    const cleared = await service.clear()
    expect(cleared.entries).toEqual([])
    expect(cleared.enabled).toBe(true)
    expect(cleared.consented).toBe(true)
    expect(service.snapshot().entries).toEqual([])
  })

  it('serializes concurrent mutations so the cap cannot be exceeded', async () => {
    const { service } = await active({ maxEntries: 1 })
    const results = await Promise.allSettled([
      service.save({ text: 'first', kind: 'fact' }),
      service.save({ text: 'second', kind: 'fact' }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(service.list()).toHaveLength(1)
  })

  it('persists entries and settings across a provider restart', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({ pool })
    await first.service.setConsent(true)
    await first.service.setEnabled(true)
    const saved = await first.service.save({ text: 'durable', kind: 'fact' })
    await first.fiber.dispose()

    const second = await harness({ pool })
    dispose.push(() => second.fiber.dispose())
    expect(second.service.snapshot()).toMatchObject({ enabled: true, consented: true })
    expect(second.service.list()).toHaveLength(1)
    expect(second.service.list()[0]).toMatchObject({ id: saved.id, text: 'durable', kind: 'fact' })
  })

  it('exposes the snapshot through the decorated Remote projection', async () => {
    const { service } = await active()
    await service.save({ text: 'remote', kind: 'fact' })
    await expect(service.remoteSnapshot()).resolves.toMatchObject({
      enabled: true,
      consented: true,
      entries: [{ text: 'remote' }],
    })
  })

  it('reports not-ready before initialization and after disposal', async () => {
    const raw = new MemoryLocalService(new Context(), {})
    expect(raw.enabled).toBe(false)
    expect(raw.consented).toBe(false)
    expect(raw.list()).toEqual([])
    await expect(raw.setConsent(true)).rejects.toMatchObject({ code: 'not-ready' })
    await expect(raw.clear()).rejects.toMatchObject({ code: 'not-ready' })
    await expect(raw.update('mem-x' as never, 'text')).rejects.toMatchObject({ code: 'not-ready' })
    await expect(raw.forget('mem-x' as never)).rejects.toMatchObject({ code: 'not-ready' })

    const { service, fiber } = await active()
    await fiber.dispose()
    await expect(service.save({ text: 'after', kind: 'fact' })).rejects.toMatchObject({ code: 'not-ready' })
    await expect(service.setEnabled(false)).rejects.toMatchObject({ code: 'not-ready' })
  })
})
