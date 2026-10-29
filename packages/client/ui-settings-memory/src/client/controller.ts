/**
 * Browser object layer over the Host memory service. It owns one snapshot for
 * the settings page, serializes mutations, and turns carrier failures into
 * visible page errors.
 * @module @deepseek-ai/dsh-client-ui-settings-memory/client/controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MemoryEntry, MemoryId, MemoryKind, MemorySnapshot } from '@deepseek-ai/dsh-memory/types'

/** What the memory settings page renders. */
export interface MemorySectionState {
  /** Load lifecycle of the first read. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Last operation failure, or null. */
  error: string | null
  /** Whether a mutation is in flight. */
  busy: boolean
  /** Whether model-visible memory is enabled. */
  enabled: boolean
  /** Whether the user has recorded consent. */
  consented: boolean
  /** Entries in most-recently-updated order. */
  entries: readonly MemoryEntry[]
}

const INITIAL: MemorySectionState = {
  status: 'idle',
  error: null,
  busy: false,
  enabled: false,
  consented: false,
  entries: [],
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Loads and mutates memory through the generated Remote namespace. */
export class MemorySectionController {
  /** Observable page state. */
  readonly store: SnapshotStore<MemorySectionState> = createSnapshotStore(INITIAL)
  private loading: Promise<void> | undefined
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Browser plugin context carrying the mounted `remote.memory`
   * namespace.
   */
  constructor(private readonly ctx: ClientContext) {}

  private set(patch: Partial<MemorySectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private apply(snapshot: MemorySnapshot): void {
    this.set({
      status: 'ready',
      error: null,
      enabled: snapshot.enabled,
      consented: snapshot.consented,
      entries: snapshot.entries,
    })
  }

  /**
   * Read the authoritative snapshot once; concurrent callers share the read.
   * @returns once the read settles.
   */
  load(): Promise<void> {
    return this.loading ??= this.read().finally(() => { this.loading = undefined })
  }

  private async read(): Promise<void> {
    this.set({ status: 'loading', error: null })
    try {
      const carried = await this.ctx.remote.memory.snapshot()
      if (!carried.ok) throw new Error(carried.error.message)
      this.apply(carried.value)
    } catch (error) {
      this.set({ status: 'error', error: messageOf(error) })
    }
  }

  private async refresh(): Promise<void> {
    const carried = await this.ctx.remote.memory.snapshot()
    if (!carried.ok) throw new Error(carried.error.message)
    this.apply(carried.value)
  }

  private mutate(work: () => Promise<void>): Promise<boolean> {
    const run = this.chain.then(async () => {
      this.set({ busy: true, error: null })
      try {
        await work()
        return true
      } catch (error) {
        this.set({ error: messageOf(error) })
        return false
      } finally {
        this.set({ busy: false })
      }
    })
    this.chain = run
    return run
  }

  /**
   * Record consent and enable memory in one user action.
   * @returns once both durable writes settle.
   */
  consent(): Promise<boolean> {
    return this.mutate(async () => {
      const consented = await this.ctx.remote.memory.setConsent(true)
      if (!consented.ok) throw new Error(consented.error.message)
      const enabled = await this.ctx.remote.memory.setEnabled(true)
      if (!enabled.ok) throw new Error(enabled.error.message)
      this.apply(enabled.value)
    })
  }

  /**
   * Enable or disable memory while keeping consent and entries.
   * @param enabled - desired availability.
   * @returns once the durable write settles.
   */
  setEnabled(enabled: boolean): Promise<boolean> {
    return this.mutate(async () => {
      const carried = await this.ctx.remote.memory.setEnabled(enabled)
      if (!carried.ok) throw new Error(carried.error.message)
      this.apply(carried.value)
    })
  }

  /**
   * Save one new entry and refresh the list.
   * @param text - the remembered sentence.
   * @param kind - why it is kept.
   * @returns whether the save succeeded.
   */
  save(text: string, kind: MemoryKind): Promise<boolean> {
    return this.mutate(async () => {
      const carried = await this.ctx.remote.memory.save({ text, kind })
      if (!carried.ok) throw new Error(carried.error.message)
      await this.refresh()
    })
  }

  /**
   * Replace one entry's text and refresh the list.
   * @param id - entry to edit.
   * @param text - replacement text.
   * @returns whether the edit succeeded.
   */
  update(id: MemoryId, text: string): Promise<boolean> {
    return this.mutate(async () => {
      const carried = await this.ctx.remote.memory.update(id, text)
      if (!carried.ok) throw new Error(carried.error.message)
      await this.refresh()
    })
  }

  /**
   * Delete one entry and refresh the list.
   * @param id - entry to delete.
   * @returns whether the delete succeeded.
   */
  forget(id: MemoryId): Promise<boolean> {
    return this.mutate(async () => {
      const carried = await this.ctx.remote.memory.forget(id)
      if (!carried.ok) throw new Error(carried.error.message)
      await this.refresh()
    })
  }

  /**
   * Delete every entry and publish the returned empty snapshot.
   * @returns whether the clear succeeded.
   */
  clear(): Promise<boolean> {
    return this.mutate(async () => {
      const carried = await this.ctx.remote.memory.clear()
      if (!carried.ok) throw new Error(carried.error.message)
      this.apply(carried.value)
    })
  }
}

/** Actions and the snapshot hook injected into the settings section. */
export interface MemorySectionInjected {
  /** Renderer-bound page state. */
  hooks: {
    /** Page snapshot bound by the renderer as useMemory. */
    memory: SnapshotStore<MemorySectionState>
  }
  /** Read the authoritative snapshot. */
  load: () => Promise<void>
  /** Record consent and enable memory. */
  consent: () => Promise<boolean>
  /** Enable or disable memory. */
  setEnabled: (enabled: boolean) => Promise<boolean>
  /** Save a new entry. */
  save: (text: string, kind: MemoryKind) => Promise<boolean>
  /** Edit one entry. */
  update: (id: MemoryId, text: string) => Promise<boolean>
  /** Delete one entry. */
  forget: (id: MemoryId) => Promise<boolean>
  /** Delete every entry. */
  clear: () => Promise<boolean>
}
