/**
 * Durable memory layout: one global consent/enable record plus entries keyed
 * by opaque memory id. The zod schemas validate the stored format at the
 * storage boundary.
 * @module @deepseek-ai/dsh-memory-local/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryId } from '@deepseek-ai/dsh-memory/types'

const memoryKind = z.enum(['user', 'preference', 'fact'])

/** Durable shape of one memory entry. */
export const memoryRecordSchema = z.object({
  text: z.string().min(1),
  kind: memoryKind,
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored memory entry, without its table key. */
export type MemoryRecord = z.infer<typeof memoryRecordSchema>

/** Durable consent and availability state. */
export const memoryGlobalSchema = z.object({
  enabled: z.boolean(),
  consented: z.boolean(),
})

/** Durable consent and availability state inferred from {@link memoryGlobalSchema}. */
export type MemoryGlobal = z.infer<typeof memoryGlobalSchema>

/**
 * The memory domain: a `memory` unit with one global settings record and an
 * `entries` table. `enabled` starts false and consent starts unrecorded, so a
 * fresh install exposes no memory tools or prompt text.
 */
export const memoryDomainSpec = defineDomain({
  name: 'memory',
  version: 1,
  global: {
    schema: memoryGlobalSchema,
    initial: { enabled: false, consented: false },
  },
  tables: {
    entries: domainTable<MemoryId, MemoryRecord>(memoryRecordSchema),
  },
})
