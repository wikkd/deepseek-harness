/**
 * Per-project listing manifest: a best-effort, never-authoritative validated
 * cache of the selected generation and header line per Session directory.
 * Loss, corruption, or staleness is silently rebuilt from the filesystem; the
 * manifest never changes observable list() output and is never crash-durable.
 * @module dsh-session-persistence-jsonl/list-manifest
 */

import { open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { JsonlCompression } from './format.ts'

/** One manifest file per project directory; the dot prefix keeps it invisible to directory-only scans. */
export const MANIFEST_BASENAME = '.dsh-sessions.json'

/**
 * One cached Session-directory entry. bigint stat fields serialize as decimal
 * strings: JSON cannot carry BigInt and nanosecond timestamps overflow Number.
 */
export interface SessionManifestEntryV1 {
  /** Selected generation filename, e.g. `session.v3.jsonl.zstd`. */
  readonly filename: string
  readonly sourceVersion: number
  /**
   * Decoded header first line; `null` records a directory whose selected file
   * has no readable header (empty or malformed), which list() always omits.
   */
  readonly headerLine: string | null
  readonly dirDev: string
  readonly dirMtimeNs: string
  readonly dirCtimeNs: string
  readonly fileDev: string
  readonly fileIno: string
  readonly fileSize: string
  readonly fileMtimeNs: string
  readonly fileCtimeNs: string
}

/**
 * One project's list-manifest document (`.dsh-sessions.json`, v1). A
 * best-effort cache — never authoritative: every consumer revalidates
 * entries against live stat and falls back to a full directory read.
 */
export interface SessionManifestV1 {
  readonly version: 1
  /** Session format version at write time; a mismatch voids the whole document. */
  readonly formatVersion: number
  /** Backend encoding at write time; a mismatch voids the whole document (filenames differ). */
  readonly compression: JsonlCompression
  /** Session directory basename → its cached generation/header/stat identity. */
  readonly entries: Record<string, SessionManifestEntryV1>
}

/** Whether a parsed document carries exactly the v1 shape this module reads. */
function isManifestV1(value: unknown, formatVersion: number, compression: JsonlCompression): value is SessionManifestV1 {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (doc['version'] !== 1 || doc['formatVersion'] !== formatVersion || doc['compression'] !== compression) return false
  if (typeof doc['entries'] !== 'object' || doc['entries'] === null) return false
  return Object.values(doc['entries']).every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as Partial<SessionManifestEntryV1>
    return typeof candidate.filename === 'string'
      && typeof candidate.sourceVersion === 'number'
      && (candidate.headerLine === null || typeof candidate.headerLine === 'string')
      && typeof candidate.dirDev === 'string' && typeof candidate.dirMtimeNs === 'string'
      && typeof candidate.dirCtimeNs === 'string'
      && typeof candidate.fileDev === 'string' && typeof candidate.fileIno === 'string'
      && typeof candidate.fileSize === 'string' && typeof candidate.fileMtimeNs === 'string'
      && typeof candidate.fileCtimeNs === 'string'
  })
}

/**
 * Serialize one bigint stat field as the decimal string the JSON document carries.
 * @param value - the stat field (device, inode, size, or timestamp).
 * @returns the decimal string form recorded in the manifest.
 */
export function manifestStatField(value: bigint): string {
  return value.toString(10)
}

/**
 * Whether one bigint stat field still equals its cached decimal-string form.
 * @param value - the freshly taken stat field.
 * @param cached - the decimal-string form recorded in the manifest.
 * @returns true when the field is unchanged since the cache was written.
 */
export function manifestStatMatches(value: bigint, cached: string): boolean {
  return value.toString(10) === cached
}

interface CachedDocument {
  doc: SessionManifestV1
  dirty: boolean
  /** Whether a manifest file existed (or was written) for this project already. */
  present: boolean
}

/**
 * One list() call's manifest working set: lazy per-project load, dirty
 * tracking, and a best-effort publish. Instances are call-scoped; concurrent
 * list() calls (in-process or across processes) each run their own cache and
 * the last atomic rename wins — lost entries rebuild on the next list.
 */
export class ProjectManifestCache {
  private readonly documents = new Map<string, CachedDocument>()

  /**
   * Load one project's document, treating every read failure — missing,
   * torn, malformed, foreign-version, or otherwise unreadable — as an empty
   * cache. Unlike storage reads, errors are swallowed here on purpose: the
   * manifest is not part of the storage contract, and a broken cache must
   * degrade to the uncached path rather than fail list().
   * @param project - absolute persistence root directory holding the manifest.
   * @param compression - compression codec the document must declare.
   * @param formatVersion - log format version the document must declare.
   * @returns the project's manifest document, empty when none was readable.
   */
  async docOf(
    project: string,
    compression: JsonlCompression,
    formatVersion: number,
  ): Promise<SessionManifestV1> {
    const cached = this.documents.get(project)
    if (cached !== undefined) return cached.doc
    let doc: SessionManifestV1 = { version: 1, formatVersion, compression, entries: {} }
    let present = false
    try {
      const handle = await open(join(project, MANIFEST_BASENAME), 'r')
      try {
        const parsed: unknown = JSON.parse(await handle.readFile('utf8'))
        if (isManifestV1(parsed, formatVersion, compression)) {
          doc = parsed
          present = true
        }
      } finally {
        await handle.close()
      }
    } catch {
      // Missing or unreadable manifest: rebuild from the filesystem.
    }
    this.documents.set(project, { doc, dirty: false, present })
    return doc
  }

  /**
   * Record one freshly resolved entry for a Session directory.
   * @param project - absolute persistence root directory the manifest belongs to.
   * @param dirName - Session directory basename inside the project.
   * @param entry - the resolved manifest entry to publish for that directory.
   */
  put(project: string, dirName: string, entry: SessionManifestEntryV1): void {
    const cached = this.documents.get(project)
    if (cached === undefined) return
    cached.doc.entries[dirName] = entry
    cached.dirty = true
    cached.present = true
  }

  /**
   * Forget one Session directory's entry (the directory disappeared).
   * @param project - absolute persistence root directory the manifest belongs to.
   * @param dirName - Session directory basename whose entry is dropped.
   */
  drop(project: string, dirName: string): void {
    const cached = this.documents.get(project)
    if (cached === undefined) return
    if (!(dirName in cached.doc.entries)) return
    Reflect.deleteProperty(cached.doc.entries, dirName)
    cached.dirty = true
  }

  /**
   * Publish dirty documents. Best-effort: every error — including abort and
   * ENOENT for vanished project directories — is swallowed, because a stale
   * or missing cache only costs the next list() a rebuild.
   */
  async flush(): Promise<void> {
    for (const [project, cached] of this.documents) {
      if (!cached.dirty) continue
      try {
        const finalPath = join(project, MANIFEST_BASENAME)
        const tmp = `${finalPath}.${randomBytes(6).toString('hex')}.tmp`
        const handle = await open(tmp, 'wx', 0o600)
        try {
          // No fsync: the manifest is a cache, and a torn post-crash document
          // simply fails JSON.parse and rebuilds on the next list().
          await handle.writeFile(JSON.stringify(cached.doc, null, 1))
        } finally {
          await handle.close()
        }
        await rename(tmp, finalPath)
        cached.dirty = false
        cached.present = true
      } catch {
        // A lost cache write costs one uncached list(); nothing else.
      }
    }
  }
}
