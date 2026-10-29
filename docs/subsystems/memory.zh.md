# 长期记忆

[English](memory.md) | 中文

长期记忆跨会话保存用户事实、偏好和背景上下文。[记忆约定](../../packages/memory/memory/README.zh.md)定义服务与条目词汇；[本地提供方](../../packages/memory/memory-local/README.zh.md)负责同意状态、边界与持久化 JSON 存储；[模型工具](../../packages/memory/tool-memory/README.zh.md)负责显式保存、搜索、遗忘以及有界的提示词区段。

## 条目与标识

`MemoryId` 是[品牌化 id](core.zh.md#branded-ids)。`MEMORY_KINDS` 固定接受的类别：`user`、`preference` 和 `fact`。文本在存储前会去除首尾空白且永不为空；完全重复的保存会刷新现有条目的类别与更新时间，而不是创建第二条记录。

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

## 同意、可用性与快照

`MemorySettings` 将显式同意与模型可见的可用性分开。全新的提供方会把两个字段都报告为 `false`；启用需要已记录的同意，撤回同意也会关闭可用性。关闭会保留条目与同意。`MemorySnapshot` 是设置界面渲染的一致设置与条目视图。

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

## 服务行为

`MemoryService` 是 Host 约定。`list()` 与 `snapshot()` 同步读取活跃提供方，因此提示词组装不必等待磁盘。每次变更都会在 promise 结算前持久化。`forget()` 将不存在的 id 视为幂等未命中。`clear()` 删除条目但不改变同意或可用性。

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

## 失败

`MemoryError` 携带稳定代码，让调用方无需解析文本即可选择具体的恢复消息。本地提供方会在存储不可用、记忆被关闭或未同意、文本为空或过长、达到条目数量上限、重复、id 缺失以及类别未知时抛出这些代码。

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

## 模型边界

仅当 `enabled` 与 `consented` 同时为真时，记忆才对模型可见。提示词区段把条目作为背景事实呈现，而不是指令。`memory/settings-changed` 事件宣告持久设置发生变化，使工具包无需重启应用即可添加或撤下工具与提示词区段。下方生成的 API 记录服务与事件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
