/**
 * Local durable long-term memory provider. Entries live in the storage domain
 * under the product data home; no network service or model call participates.
 * @module @deepseek-ai/dsh-memory-local
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MEMORY_KINDS, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryEntry,
  MemoryId,
  MemorySaveInput,
  MemoryService,
  MemorySnapshot,
} from '@deepseek-ai/dsh-memory'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomainSpec } from './spec.ts'
import type { MemoryGlobal, MemoryRecord } from './spec.ts'

/** Default maximum number of retained entries. */
const DEFAULT_MAX_ENTRIES = 200
/** Default maximum trimmed text length in UTF-16 code units. */
const DEFAULT_MAX_ENTRY_CHARS = 2_000

/** Deployment bounds for the local memory store. */
export interface Config {
  /** Maximum number of retained entries; the oldest write is refused once full. */
  maxEntries?: number
  /** Maximum trimmed length of one entry in UTF-16 code units. */
  maxEntryChars?: number
}

/** Loader schema for the memory store bounds. */
export const Config: z<Config> = z.object({
  maxEntries: z.number().step(1).min(1).max(10_000).default(DEFAULT_MAX_ENTRIES),
  maxEntryChars: z.number().step(1).min(1).max(100_000).default(DEFAULT_MAX_ENTRY_CHARS),
})

function entryOf(id: MemoryId, record: MemoryRecord): MemoryEntry {
  return Object.freeze({
    id,
    kind: record.kind,
    text: record.text,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

/** Compare newest-first, then by stable id for deterministic snapshots. */
function compareEntries(left: MemoryEntry, right: MemoryEntry): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
}

/**
 * Local memory service over one durable storage domain. Reads are synchronous
 * from the domain's authoritative in-memory state; every mutation queues on one
 * chain so deduplication and settings changes cannot interleave.
 */
export class MemoryLocalService extends TypertRemoteService implements MemoryService {
  static inject = ['storageDomain']

  static Config: z<Config> = Config

  private readonly maxEntries: number
  private readonly maxEntryChars: number
  private storage?: {
    readonly table: KvTable<MemoryId, MemoryRecord>
    readonly global: DomainGlobal<MemoryGlobal>
  }
  private state?: MemoryGlobal
  private chain: Promise<unknown> = Promise.resolve()
  private stopping = false

  /**
   * @param ctx - Host context carrying the mounted storage domain.
   * @param config - Optional entry-count and entry-length bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxEntryChars = config.maxEntryChars ?? DEFAULT_MAX_ENTRY_CHARS
  }

  /** Open the durable domain and own its lifetime. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    try {
      const storage = { table: domain.table('entries'), global: domain.global }
      this.storage = storage
      this.state = storage.global.get()
      this.ctx.effect(() => async () => {
        this.stopping = true
        await this.chain
        await domain.close()
      }, 'memory-local: domain')
    } catch (error) {
      await domain.close()
      throw error
    }
  }

  /** Whether model-visible memory is enabled. */
  get enabled(): boolean {
    return this.state?.enabled ?? false
  }

  /** Whether the user has recorded consent. */
  get consented(): boolean {
    return this.state?.consented ?? false
  }

  /** Read every entry in most-recently-updated order. */
  list(): readonly MemoryEntry[] {
    if (this.storage === undefined) return Object.freeze([])
    const entries = [...this.storage.table.entries()].map(([id, record]) => entryOf(id, record))
    entries.sort(compareEntries)
    return Object.freeze(entries)
  }

  /** Read settings and entries as one consistent snapshot. */
  snapshot(): MemorySnapshot {
    return Object.freeze({
      enabled: this.enabled,
      consented: this.consented,
      entries: this.list(),
    })
  }

  /**
   * Enable or disable model-visible memory. Enabling requires prior consent.
   * @param enabled - desired availability.
   * @returns the durable snapshot after the change.
   */
  @Remote('setEnabled')
  setEnabled(enabled: boolean): Promise<MemorySnapshot> {
    return this.serialize(async () => {
      const state = this.requireState()
      if (enabled && !state.consented) {
        throw new MemoryError('consent-required', 'Enable memory only after recording consent.')
      }
      const next: MemoryGlobal = { ...state, enabled }
      await this.requireStorage().global.set(next)
      this.state = next
      this.emitSettings(next)
      return this.snapshot()
    })
  }

  /**
   * Record or withdraw consent. Withdrawing consent also disables memory.
   * @param consented - whether the user agrees to local memory storage.
   * @returns the durable snapshot after the change.
   */
  @Remote('setConsent')
  setConsent(consented: boolean): Promise<MemorySnapshot> {
    return this.serialize(async () => {
      const state = this.requireState()
      const next: MemoryGlobal = { enabled: consented ? state.enabled : false, consented }
      await this.requireStorage().global.set(next)
      this.state = next
      this.emitSettings(next)
      return this.snapshot()
    })
  }

  /**
   * Save a new entry, or refresh the kind and timestamp of an exact duplicate.
   * @param input - trimmed text and its durable category.
   * @returns the stored entry.
   */
  @Remote('save')
  save(input: MemorySaveInput): Promise<MemoryEntry> {
    return this.serialize(async () => {
      this.assertActive()
      if (!MEMORY_KINDS.includes(input.kind)) {
        throw new MemoryError('invalid-kind', `Unknown memory kind "${input.kind}".`)
      }
      const text = this.normalizeText(input.text)
      const table = this.requireTable()
      const existing = [...table.entries()].find(([, record]) => record.text === text)
      if (existing !== undefined) {
        const [id, record] = existing
        const next: MemoryRecord = { ...record, kind: input.kind, updatedAt: new Date().toISOString() }
        await table.put(id, next)
        return entryOf(id, next)
      }
      if (table.size >= this.maxEntries) {
        throw new MemoryError('limit', `Memory can hold at most ${this.maxEntries} entries.`)
      }
      const id = brandString<MemoryId>(`mem-${randomUUID()}`)
      const now = new Date().toISOString()
      const record: MemoryRecord = { kind: input.kind, text, createdAt: now, updatedAt: now }
      await table.put(id, record)
      return entryOf(id, record)
    })
  }

  /**
   * Replace one entry's text while preserving its identity and creation time.
   * @param id - entry to edit.
   * @param text - replacement text, trimmed before validation.
   * @returns the stored entry.
   */
  @Remote('update')
  update(id: MemoryId, text: string): Promise<MemoryEntry> {
    return this.serialize(async () => {
      const table = this.requireTable()
      const existing = table.get(id)
      if (existing === undefined) throw new MemoryError('not-found', 'That memory no longer exists.')
      const normalized = this.normalizeText(text)
      for (const [otherId, record] of table.entries()) {
        if (otherId !== id && record.text === normalized) {
          throw new MemoryError('duplicate', 'Another memory already has that text.')
        }
      }
      const next: MemoryRecord = { ...existing, text: normalized, updatedAt: new Date().toISOString() }
      await table.put(id, next)
      return entryOf(id, next)
    })
  }

  /**
   * Delete one entry. Deleting an absent entry is an idempotent miss.
   * @param id - entry to delete.
   * @returns whether the entry existed.
   */
  @Remote('forget')
  forget(id: MemoryId): Promise<boolean> {
    return this.serialize(() => this.requireTable().delete(id))
  }

  /**
   * Delete every entry without changing consent or availability.
   * @returns the empty durable snapshot.
   */
  @Remote('clear')
  clear(): Promise<MemorySnapshot> {
    return this.serialize(async () => {
      const table = this.requireTable()
      for (const id of [...table.keys()]) await table.delete(id)
      return this.snapshot()
    })
  }

  /**
   * Remote projection of {@link snapshot}; generated clients call this name.
   * @returns the current durable snapshot.
   */
  @Remote('snapshot')
  remoteSnapshot(): Promise<MemorySnapshot> {
    return Promise.resolve(this.snapshot())
  }

  /** Trim and validate one entry's text at the durable boundary. */
  private normalizeText(text: string): string {
    const normalized = text.trim()
    if (normalized.length === 0) throw new MemoryError('blank', 'A memory needs some text.')
    if (normalized.length > this.maxEntryChars) {
      throw new MemoryError('too-large', `A memory can hold at most ${this.maxEntryChars} characters.`)
    }
    return normalized
  }

  private assertActive(): void {
    if (!this.consented) throw new MemoryError('consent-required', 'Enable memory before saving.')
    if (!this.enabled) throw new MemoryError('disabled', 'Memory is turned off.')
  }

  private requireStorage(): {
    readonly table: KvTable<MemoryId, MemoryRecord>
    readonly global: DomainGlobal<MemoryGlobal>
  } {
    if (this.storage === undefined) throw new MemoryError('not-ready', 'Memory storage is not ready yet.')
    return this.storage
  }

  private requireTable(): KvTable<MemoryId, MemoryRecord> {
    return this.requireStorage().table
  }

  private requireState(): MemoryGlobal {
    if (this.state === undefined) throw new MemoryError('not-ready', 'Memory storage is not ready yet.')
    return this.state
  }

  private emitSettings(settings: MemoryGlobal): void {
    this.ctx.emit('memory/settings-changed', { enabled: settings.enabled, consented: settings.consented })
  }

  /** Serialize complete mutations and preserve FIFO progress after failures. */
  private serialize<T>(work: () => Promise<T> | T): Promise<T> {
    if (this.stopping) return Promise.reject(new MemoryError('not-ready', 'Memory storage is shutting down.'))
    const pending = this.chain.then(work)
    this.chain = pending.then(() => undefined, () => undefined)
    return pending
  }
}

export default MemoryLocalService
