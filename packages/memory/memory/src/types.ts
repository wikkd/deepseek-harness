/**
 * Public memory vocabulary shared by the Host provider, model tools, and the
 * generated Remote client. This module is type-safe for browser consumption;
 * only the Host provider owns persistence.
 * @module @deepseek-ai/dsh-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
// Type-only: establishes the module dependency the augmentation below extends.
import type {} from '@deepseek-ai/cordis'

/** Opaque identity of one durable memory entry. */
export type MemoryId = Branded<'MemoryId'>

/** Why a memory entry is kept. */
export type MemoryKind = 'user' | 'preference' | 'fact'

/** Every accepted {@link MemoryKind}, in display order. */
export const MEMORY_KINDS: readonly MemoryKind[] = Object.freeze(['user', 'preference', 'fact'])

/** One durable memory entry. Text is trimmed and never empty. */
export interface MemoryEntry {
  /** Stable identity used by edit and delete actions. */
  readonly id: MemoryId
  /** Why the entry is kept. */
  readonly kind: MemoryKind
  /** The remembered sentence, preserved verbatim after trimming. */
  readonly text: string
  /** ISO-8601 creation time. */
  readonly createdAt: string
  /** ISO-8601 time of the most recent text or kind change. */
  readonly updatedAt: string
}

/** User-controlled availability of long-term memory. */
export interface MemorySettings {
  /** Whether memory tools and prompt injection are available to the model. */
  readonly enabled: boolean
  /** Whether the user has explicitly agreed to local memory storage. */
  readonly consented: boolean
}

/** The complete memory state a settings surface renders. */
export interface MemorySnapshot extends MemorySettings {
  /** Entries in most-recently-updated order. */
  readonly entries: readonly MemoryEntry[]
}

/** A user-requested save; the provider trims and deduplicates the text. */
export interface MemorySaveInput {
  /** The remembered sentence. */
  readonly text: string
  /** Why the entry is kept. */
  readonly kind: MemoryKind
}

/** Stable failure category of {@link MemoryError}. */
export type MemoryErrorCode =
  | 'not-ready'
  | 'disabled'
  | 'consent-required'
  | 'blank'
  | 'too-large'
  | 'limit'
  | 'duplicate'
  | 'not-found'
  | 'invalid-kind'

/**
 * A rejected memory operation whose code lets the caller choose a specific
 * recovery message without parsing prose.
 */
export class MemoryError extends Error {
  /** Stable failure category. */
  readonly code: MemoryErrorCode

  /**
   * @param code - stable failure category.
   * @param message - actionable explanation for a human.
   */
  constructor(code: MemoryErrorCode, message: string) {
    super(message)
    this.name = 'MemoryError'
    this.code = code
  }
}

/**
 * Host-side memory contract. Reads are synchronous from the active provider;
 * every mutation is durable before its promise settles.
 */
export interface MemoryService {
  /** Whether the user has enabled memory. */
  readonly enabled: boolean
  /** Whether the user has explicitly consented to memory storage. */
  readonly consented: boolean

  /**
   * Read every entry in most-recently-updated order.
   * @returns every stored entry, newest first.
   */
  list(): readonly MemoryEntry[]

  /**
   * Read settings and entries as one consistent snapshot.
   * @returns the current availability, consent, and entries.
   */
  snapshot(): MemorySnapshot

  /**
   * Enable or disable model-visible memory. Enabling requires prior consent.
   * @param enabled - desired availability.
   * @returns the durable snapshot after the change.
   */
  setEnabled(enabled: boolean): Promise<MemorySnapshot>

  /**
   * Record or withdraw consent. Withdrawing consent also disables memory.
   * @param consented - whether the user agrees to local memory storage.
   * @returns the durable snapshot after the change.
   */
  setConsent(consented: boolean): Promise<MemorySnapshot>

  /**
   * Save a new entry, or refresh the kind and timestamp of an exact duplicate.
   * @param input - trimmed text and its durable category.
   * @returns the stored entry.
   */
  save(input: MemorySaveInput): Promise<MemoryEntry>

  /**
   * Replace one entry's text while preserving its identity and creation time.
   * @param id - entry to edit.
   * @param text - replacement text, trimmed before validation.
   * @returns the stored entry.
   */
  update(id: MemoryId, text: string): Promise<MemoryEntry>

  /**
   * Delete one entry. Deleting an absent entry is an idempotent miss.
   * @param id - entry to delete.
   * @returns whether the entry existed.
   */
  forget(id: MemoryId): Promise<boolean>

  /**
   * Delete every entry without changing consent or availability.
   * @returns the empty durable snapshot.
   */
  clear(): Promise<MemorySnapshot>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable long-term memory owned by the local provider. */
    memory: MemoryService
  }

  interface Events {
    /**
     * Memory availability changed, so model-visible tools and prompt sections
     * must be added or withdrawn without restarting the application.
     * @param settings - the durable settings after the change.
     * @mode emit
     */
    'memory/settings-changed'(settings: MemorySettings): void
  }
}
