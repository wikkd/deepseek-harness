/**
 * Long-term memory contract for the DeepSeek Harness: explicit saves, user
 * consent, durable local storage, and a bounded settings surface.
 * @module @deepseek-ai/dsh-memory
 */

export { MEMORY_KINDS, MemoryError } from './types.ts'
export type {
  MemoryEntry,
  MemoryErrorCode,
  MemoryId,
  MemoryKind,
  MemorySaveInput,
  MemoryService,
  MemorySettings,
  MemorySnapshot,
} from './types.ts'
