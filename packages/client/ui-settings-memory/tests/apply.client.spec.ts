import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { MemoryId } from '@deepseek-ai/dsh-memory/types'
import { apply, inject, NS, type MemorySectionInjected } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const memory = {
    snapshot: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { enabled: false, consented: false, entries: [] },
    })),
    setConsent: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { enabled: false, consented: true, entries: [] },
    })),
    setEnabled: vi.fn((enabled: boolean) => Promise.resolve({
      ok: true as const,
      value: { enabled, consented: true, entries: [] },
    })),
    save: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        id: 'mem-1',
        kind: 'user',
        text: 'saved',
        createdAt: '2026-10-22T00:00:00.000Z',
        updatedAt: '2026-10-22T00:00:00.000Z',
      },
    })),
    update: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        id: 'mem-1',
        kind: 'user',
        text: 'edited',
        createdAt: '2026-10-22T00:00:00.000Z',
        updatedAt: '2026-10-22T00:00:00.000Z',
      },
    })),
    forget: vi.fn(() => Promise.resolve({ ok: true as const, value: true })),
    clear: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { enabled: true, consented: true, entries: [] },
    })),
  }
  new TestRemote(ctx, { memory })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, memory }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-memory apply', () => {
  it('keeps the Host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.memory'])
  })

  it('registers one section with a localized label and a face that reaches Remote', async () => {
    const { ctx, slots, memory } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'memory', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('记忆')
    expect(entry.locale).toBe(NS)
    const face = entry.inject?.() as MemorySectionInjected | undefined
    expect(face).toBeDefined()
    if (face === undefined) throw new Error('the memory section did not expose its injected face')
    expect(face.hooks.memory).toBeDefined()

    await face.load()
    expect(memory.snapshot).toHaveBeenCalledOnce()
    await expect(face.consent()).resolves.toBe(true)
    expect(memory.setConsent).toHaveBeenCalledWith(true)
    await expect(face.setEnabled(true)).resolves.toBe(true)
    expect(memory.setEnabled).toHaveBeenCalledWith(true)
    await expect(face.save('saved', 'user')).resolves.toBe(true)
    expect(memory.save).toHaveBeenCalledWith({ text: 'saved', kind: 'user' })
    await expect(face.update('mem-1' as MemoryId, 'edited')).resolves.toBe(true)
    expect(memory.update).toHaveBeenCalledWith('mem-1', 'edited')
    await expect(face.forget('mem-1' as MemoryId)).resolves.toBe(true)
    expect(memory.forget).toHaveBeenCalledWith('mem-1')
    await expect(face.clear()).resolves.toBe(true)
    expect(memory.clear).toHaveBeenCalledOnce()
  })

  it('removes the section and its dictionary with the fiber', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(() => ctx.locale.bind(NS)).not.toThrow()
  })
})
