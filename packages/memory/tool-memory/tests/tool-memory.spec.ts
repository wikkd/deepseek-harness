import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryEntry,
  MemoryId,
  MemoryKind,
  MemorySaveInput,
  MemoryService,
  MemorySnapshot,
} from '@deepseek-ai/dsh-memory'
import * as tool from '../src/index.ts'

const signal = new AbortController().signal
let calls = 0

function entry(id: string, text: string, kind: MemoryKind = 'fact'): MemoryEntry {
  return {
    id: id as MemoryId,
    text,
    kind,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  }
}

/** Minimal in-process memory service; persistence is covered by memory-local. */
class FakeMemory implements MemoryService {
  enabled = false
  consented = false
  entries: MemoryEntry[] = []
  private seq = 0

  constructor(options: { enabled?: boolean; consented?: boolean; entries?: MemoryEntry[] } = {}) {
    this.enabled = options.enabled ?? false
    this.consented = options.consented ?? false
    this.entries = [...(options.entries ?? [])]
  }

  list(): readonly MemoryEntry[] {
    return this.entries
  }

  snapshot(): MemorySnapshot {
    return { enabled: this.enabled, consented: this.consented, entries: this.entries }
  }

  setEnabled(enabled: boolean): Promise<MemorySnapshot> {
    if (enabled && !this.consented) return Promise.reject(new MemoryError('consent-required', 'consent'))
    this.enabled = enabled
    return Promise.resolve(this.snapshot())
  }

  setConsent(consented: boolean): Promise<MemorySnapshot> {
    this.consented = consented
    if (!consented) this.enabled = false
    return Promise.resolve(this.snapshot())
  }

  save(input: MemorySaveInput): Promise<MemoryEntry> {
    if (!this.consented) return Promise.reject(new MemoryError('consent-required', 'consent'))
    if (!this.enabled) return Promise.reject(new MemoryError('disabled', 'disabled'))
    const saved = entry(`mem-${++this.seq}`, input.text.trim(), input.kind)
    this.entries.push(saved)
    return Promise.resolve(saved)
  }

  update(id: MemoryId, text: string): Promise<MemoryEntry> {
    const index = this.entries.findIndex(candidate => candidate.id === id)
    if (index < 0) return Promise.reject(new MemoryError('not-found', 'missing'))
    const updated = { ...this.entries[index]!, text }
    this.entries[index] = updated
    return Promise.resolve(updated)
  }

  forget(id: MemoryId): Promise<boolean> {
    const index = this.entries.findIndex(candidate => candidate.id === id)
    if (index < 0) return Promise.resolve(false)
    this.entries.splice(index, 1)
    return Promise.resolve(true)
  }

  clear(): Promise<MemorySnapshot> {
    this.entries = []
    return Promise.resolve(this.snapshot())
  }
}

interface HarnessOptions {
  readonly enabled?: boolean
  readonly consented?: boolean
  readonly entries?: MemoryEntry[]
  readonly config?: tool.Config
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const memory = new FakeMemory(options)
  ctx.provide('memory', memory as never)
  const fiber = await ctx.plugin(tool, options.config ?? {})
  return { ctx, memory, fiber }
}

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
})

async function boot(options: HarnessOptions = {}) {
  const booted = await harness(options)
  disposers.push(() => booted.fiber.dispose())
  return booted
}

function call(ctx: Context, name: string, args: unknown) {
  calls += 1
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${calls}`),
    name,
    arguments: args,
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function memoryPrompt(ctx: Context): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'memory')?.text
}

describe('dsh-tool-memory', () => {
  it('registers the three memory tools and the prompt section only while active', async () => {
    const { ctx } = await boot({ enabled: true, consented: true })
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'memory_forget', 'memory_save', 'memory_search',
    ])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'memory')).toBe(true)
    expect(ctx.systemPrompt.getSectionOrder('MEMORY')).toBe(100)
  })

  it('keeps every model-visible memory surface absent until consent and enablement meet', async () => {
    const { ctx } = await boot()
    expect(ctx.tools.schemas().some(schema => schema.name.startsWith('memory_'))).toBe(false)
    expect(await memoryPrompt(ctx)).toBeUndefined()
  })

  it('adds and withdraws the surface on settings changes', async () => {
    const { ctx, memory } = await boot()
    memory.consented = true
    memory.enabled = false
    ctx.emit('memory/settings-changed', { enabled: false, consented: true })
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_save')).toBe(false)

    memory.enabled = true
    ctx.emit('memory/settings-changed', { enabled: true, consented: true })
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_save')).toBe(true)
    expect(await memoryPrompt(ctx)).toBe('')

    await memory.save({ text: '喜欢草莓', kind: 'preference' })
    expect(await memoryPrompt(ctx)).toContain('- (preference) 喜欢草莓')

    memory.enabled = false
    ctx.emit('memory/settings-changed', { enabled: false, consented: true })
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_save')).toBe(false)
    expect(await memoryPrompt(ctx)).toBeUndefined()
  })

  it('saves, searches, and forgets through the real tool runtime', async () => {
    const { ctx, memory } = await boot({ enabled: true, consented: true })
    const saved = await call(ctx, 'memory_save', { text: ' 喜欢草莓 ', kind: 'preference' })
    expect(saved.isError).toBe(false)
    if (saved.isError) throw new Error('expected save success')
    expect(saved.value).toMatchObject({ id: 'mem-1', kind: 'preference', text: '喜欢草莓' })
    expect(text(saved)).toBe('Saved memory: 喜欢草莓')

    const found = await call(ctx, 'memory_search', { query: '草莓' })
    expect(found.isError).toBe(false)
    if (found.isError) throw new Error('expected search success')
    expect(found.value).toMatchObject({ entries: [{ id: 'mem-1', text: '喜欢草莓' }] })
    expect(text(found)).toContain('- (preference) 喜欢草莓')

    const missed = await call(ctx, 'memory_search', { query: '不存在' })
    expect(missed.isError).toBe(false)
    expect(text(missed)).toBe('No matching memories.')

    const forgot = await call(ctx, 'memory_forget', { text: ' 喜欢草莓 ' })
    expect(forgot.isError).toBe(false)
    expect(forgot.value).toEqual({ forgotten: true })
    expect(text(forgot)).toBe('Forgot that memory.')
    expect(memory.entries).toEqual([])
  })

  it('searches by kind, ignores a blank query, and caps the result set', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => entry(`mem-${index}`, `item ${index}`, index === 0 ? 'user' : 'fact'))
    const { ctx } = await boot({ enabled: true, consented: true, entries })
    const byKind = await call(ctx, 'memory_search', { query: 'user' })
    expect(byKind.isError).toBe(false)
    if (byKind.isError) throw new Error('expected search success')
    expect(byKind.value).toMatchObject({ entries: [{ id: 'mem-0' }] })

    const blank = await call(ctx, 'memory_search', { query: '   ' })
    expect(blank.isError).toBe(false)
    expect(text(blank)).toBe('No matching memories.')

    const capped = await call(ctx, 'memory_search', { query: 'item' })
    expect(capped.isError).toBe(false)
    if (capped.isError) throw new Error('expected search success')
    expect((capped.value as { entries: unknown[] }).entries).toHaveLength(20)
  })

  it('reports a forget whose text has no exact saved match without failing', async () => {
    const { ctx } = await boot({ enabled: true, consented: true, entries: [entry('mem-1', 'exact')] })
    const result = await call(ctx, 'memory_forget', { text: 'exact ' })
    expect(result.isError).toBe(false)
    const missing = await call(ctx, 'memory_forget', { text: 'missing' })
    expect(missing.isError).toBe(false)
    expect(missing.value).toEqual({ forgotten: false })
    expect(text(missing)).toBe('No matching memory exists.')
  })

  it('keeps the prompt empty if consent disappears without a settings event', async () => {
    const { ctx, memory } = await boot({
      enabled: true,
      consented: true,
      entries: [entry('mem-1', 'private fact')],
    })
    expect(await memoryPrompt(ctx)).toContain('private fact')
    memory.consented = false
    expect(await memoryPrompt(ctx)).toBe('')
  })

  it('presents each memory call with a stable card title and raw input', async () => {
    const { ctx } = await boot({ enabled: true, consented: true })
    expect(ctx.tools.get('memory_save')?.presentCall?.({ text: 'save me', kind: 'fact' })).toEqual({
      card: 'generic', title: 'Save a memory', kind: 'other', rawInput: 'save me',
    })
    expect(ctx.tools.get('memory_search')?.presentCall?.({ query: 'find me' })).toEqual({
      card: 'generic', title: 'Search memories', kind: 'other', rawInput: 'find me',
    })
    expect(ctx.tools.get('memory_forget')?.presentCall?.({ text: 'forget me' })).toEqual({
      card: 'generic', title: 'Forget a memory', kind: 'other', rawInput: 'forget me',
    })
  })

  it('applies prompt defaults when the Loader schema did not supply them', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('memory', new FakeMemory({
      enabled: true,
      consented: true,
      entries: [entry('mem-1', 'direct apply fact')],
    }) as never)
    const fiber = await ctx.plugin({
      inject: [...tool.inject],
      apply: (child: Context) => { tool.apply(child, {}) },
    })
    expect(await memoryPrompt(ctx)).toContain('direct apply fact')
    await fiber.dispose()
  })

  it('bounds the prompt by entry count and character budget', async () => {
    const entries = [
      entry('mem-1', 'first fact'),
      entry('mem-2', 'second fact'),
      entry('mem-3', 'third fact'),
    ]
    const { ctx } = await boot({ enabled: true, consented: true, entries, config: { maxPromptEntries: 2 } })
    const prompt = await memoryPrompt(ctx)
    expect(prompt).toContain('first fact')
    expect(prompt).toContain('second fact')
    expect(prompt).not.toContain('third fact')
    expect(prompt).not.toContain('instructions from memory')

    const bounded = await boot({ enabled: true, consented: true, entries, config: { maxPromptChars: 100 } })
    const clipped = await memoryPrompt(bounded.ctx)
    expect(clipped).toHaveLength(100)
    expect(clipped?.endsWith('…')).toBe(true)
  })

  it('removes tools and prompt text when the plugin is disposed', async () => {
    const { ctx, fiber } = await boot({ enabled: true, consented: true, entries: [entry('mem-1', 'durable')] })
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_save')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_save')).toBe(false)
    expect(await memoryPrompt(ctx)).toBeUndefined()
  })

  it('has the namespace-plugin export shape so the Loader keeps name and inject', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-memory')
    expect(tool.inject).toEqual(['memory', 'systemPrompt', 'tools'])
  })

  it('rejects a prompt budget below the allowed minimum at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('memory', new FakeMemory({ enabled: true, consented: true }) as never)
    await expect(ctx.plugin(tool, { maxPromptEntries: 0 })).rejects.toThrow()
  })
})
