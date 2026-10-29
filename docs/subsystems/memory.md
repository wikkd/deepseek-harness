# Long-term memory

English | [中文](memory.zh.md)

Long-term memory stores user facts, preferences, and background context across sessions. The [memory contract](../../packages/memory/memory/README.md) owns the service and entry vocabulary; the [local provider](../../packages/memory/memory-local/README.md) owns consent state, bounds, and durable JSON storage; [model tools](../../packages/memory/tool-memory/README.md) own explicit save, search, forget, and the bounded prompt section.

## Entries and identity

`MemoryId` is a [branded id](core.md#branded-ids). `MEMORY_KINDS` fixes the accepted categories: `user`, `preference`, and `fact`. Text is trimmed before storage and never empty; an exact duplicate refreshes the existing entry's category and update time instead of creating a second record.

```ts type-equiv
/** Opaque identity of one durable memory entry. */
type MemoryId = Branded<'MemoryId'>
```

```ts type-equiv
/** Why a memory entry is kept. */
type MemoryKind = 'user' | 'preference' | 'fact'
```

```ts type-equiv
/** One durable memory entry. Text is trimmed and never empty. */
interface MemoryEntry {
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
```

## Consent, availability, and snapshots

`MemorySettings` separates explicit consent from model-visible availability. A fresh provider reports both fields as `false`; enabling requires recorded consent, and withdrawing consent also disables availability. Disabling keeps entries and consent. `MemorySnapshot` is the consistent settings-and-entries view a settings surface renders.

```ts type-equiv
/** User-controlled availability of long-term memory. */
interface MemorySettings {
  /** Whether memory tools and prompt injection are available to the model. */
  readonly enabled: boolean
  /** Whether the user has explicitly agreed to local memory storage. */
  readonly consented: boolean
}
```

```ts type-equiv
/** The complete memory state a settings surface renders. */
interface MemorySnapshot extends MemorySettings {
  /** Entries in most-recently-updated order. */
  readonly entries: readonly MemoryEntry[]
}
```

```ts type-equiv
/** A user-requested save; the provider trims and deduplicates the text. */
interface MemorySaveInput {
  /** The remembered sentence. */
  readonly text: string
  /** Why the entry is kept. */
  readonly kind: MemoryKind
}
```

## Service behavior

`MemoryService` is the Host contract. `list()` and `snapshot()` read the active provider synchronously, so prompt assembly does not wait on disk. Every mutation is durable before its promise settles. `forget()` treats an absent id as an idempotent miss. `clear()` removes entries without changing consent or availability.

```ts type-equiv
/**
 * Host-side memory contract. Reads are synchronous from the active provider;
 * every mutation is durable before its promise settles.
 */
interface MemoryService {
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
```

## Failures

`MemoryError` carries a stable code so callers choose a specific recovery message without parsing prose. The local provider raises these codes for unavailable storage, disabled or unconsented operations, blank or oversized text, the entry-count limit, duplicates, missing ids, and unknown categories.

```ts type-equiv
/** Stable failure category of {@link MemoryError}. */
type MemoryErrorCode =
  | 'not-ready'
  | 'disabled'
  | 'consent-required'
  | 'blank'
  | 'too-large'
  | 'limit'
  | 'duplicate'
  | 'not-found'
  | 'invalid-kind'
```

```ts public-api
/**
 * A rejected memory operation whose code lets the caller choose a specific
 * recovery message without parsing prose.
 */
declare class MemoryError extends Error {
  /** Stable failure category. */
  readonly code: MemoryErrorCode;

  /**
   * @param code - stable failure category.
   * @param message - actionable explanation for a human.
   */
  constructor(code: MemoryErrorCode, message: string);
}
```

## Model boundary

Memory is model-visible only while `enabled` and `consented` are both true. The prompt section presents entries as background facts, not instructions. The `memory/settings-changed` event announces a durable settings change so the tool package adds or withdraws its tools and prompt section without restarting the application. The generated API below records the service and event.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice"></a>

### `ctx.memory` — `MemoryService`

Host-side memory contract. Reads are synchronous from the active provider; every mutation is durable before its promise settles.

```ts cordis-catalog
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
```

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

<a id="memory-events"></a>

### `memory/*` events

<a id="memorysettings-changed--emit"></a>

#### `memory/settings-changed` — emit

Memory availability changed, so model-visible tools and prompt sections must be added or withdrawn without restarting the application.

```ts cordis-catalog
/**
 * Memory availability changed, so model-visible tools and prompt sections
 * must be added or withdrawn without restarting the application.
 * @param settings - the durable settings after the change.
 * @mode emit
 */
'memory/settings-changed'(settings: MemorySettings): void
```

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)
<!-- END GENERATED cordis-surface -->
