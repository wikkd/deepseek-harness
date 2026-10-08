/** Isolated verification for a staged or competing current JSONL generation. */

import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { JsonlCompression } from './format.ts'
import type { JsonlExpectedPrefix, JsonlVerifiedGeneration } from './generation.ts'

/** Process-wide memory bound for full-generation verification isolates. */
const MAX_CONCURRENT_VERIFIERS = 2

class VerificationScheduler {
  private active = 0
  private readonly waiting: Array<{ grant(): void }> = []

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const permit = this.acquire(signal)
    if (permit !== undefined) await permit
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> | undefined {
    signal?.throwIfAborted()
    if (this.active < MAX_CONCURRENT_VERIFIERS) {
      this.active += 1
      return
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        grant: (): void => {
          signal?.removeEventListener('abort', abort)
          resolve()
        },
      }
      const abort = (): void => {
        const index = this.waiting.indexOf(waiter)
        this.waiting.splice(index, 1)
        reject(verifierAbortError(signal))
      }
      this.waiting.push(waiter)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) {
      this.active -= 1
      return
    }
    next.grant()
  }
}

const verificationScheduler = new VerificationScheduler()

/** Spawn one isolated task worker; development runs bootstrap TSX inline, builds load `worker.cjs`. */
export function workerSpawn(request: object): { readonly entry: string | URL; readonly options: WorkerOptions } {
  /* v8 ignore next 3 -- built-worker coverage owns the bundled path. */
  if (!import.meta.url.endsWith('.ts')) {
    return {
      entry: new URL('./worker.cjs', import.meta.url),
      options: { workerData: request, execArgv: [] },
    }
  }
  const workerEntry = new URL('./worker.ts', import.meta.url)
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}`,
    `import { register as registerCjs } from ${JSON.stringify(import.meta.resolve('tsx/cjs/api'))}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(workerEntry.href)})`,
  ].join('\n')
  return {
    entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
    options: {
      workerData: request,
      execArgv: [],
    },
  }
}

/**
 * Outcome of one isolated task. A reported failure answers the request
 * itself (the task ran and refused its input); an unreported failure means
 * the isolate never delivered a trustworthy answer (spawn, crash, invalid
 * message, abort) and callers may fall back to local work.
 */
export type IsolatedTaskOutcome<T> =
  | { readonly ok: true; readonly payload: T }
  | { readonly ok: false; readonly reported: true; readonly error: Error }
  | { readonly ok: false; readonly reported: false; readonly error: Error }

interface IsolatedTaskEnvelope {
  readonly ok: boolean
  readonly payload?: unknown
  readonly message?: unknown
  readonly stack?: unknown
}

async function runIsolatedTaskWorker<T>(
  request: object,
  signal?: AbortSignal,
): Promise<IsolatedTaskOutcome<T>> {
  signal?.throwIfAborted()
  const { entry, options } = workerSpawn(request)
  const worker = new Worker(entry, options)
  return new Promise((resolve) => {
    let settled = false
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort)
    }
    const finish = (outcome: IsolatedTaskOutcome<T>): void => {
      /* v8 ignore next -- a late error/exit races only after another terminal callback settled. */
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().then(
        () => { resolve(outcome) },
        (termination: unknown) => {
          if (outcome.ok) {
            resolve({
              ok: false,
              reported: false,
              error: termination instanceof Error ? termination : new Error(String(termination)),
            })
            return
          }
          resolve({
            ok: false,
            reported: false,
            error: new AggregateError([outcome.error, termination], 'migration verifier termination failed'),
          })
        },
      )
    }
    worker.once('message', (value: unknown) => {
      if (settled) return
      if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
        finish({ ok: false, reported: false, error: new Error('isolated task returned an invalid response') })
        return
      }
      const envelope = value as IsolatedTaskEnvelope
      if (!envelope.ok) {
        const error = new Error(typeof envelope.message === 'string' ? envelope.message : 'isolated task reported a failure')
        if (typeof envelope.stack === 'string') error.stack = envelope.stack
        finish({ ok: false, reported: true, error })
        return
      }
      finish({ ok: true, payload: envelope.payload as T })
    })
    worker.once('error', (error: Error) => {
      finish({ ok: false, reported: false, error })
    })
    worker.once('exit', (code) => {
      if (!settled) {
        finish({ ok: false, reported: false, error: new Error(`isolated task exited before reporting a result (code ${code})`) })
      }
    })
    const abort = (): void => {
      finish({ ok: false, reported: false, error: verifierAbortError(signal) })
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Run one request/response task in a fresh Worker Thread and report whether
 * its failure was the task's own answer or an isolate failure.
 * @param request - structured-cloneable task request carried in `workerData`.
 * @param signal - optional cancellation for scheduler wait and Worker execution.
 * @returns the answered payload, or a failure tagged with whether the task itself reported it.
 */
export function runIsolatedTask<T>(
  request: object,
  signal?: AbortSignal,
): Promise<IsolatedTaskOutcome<T>> {
  return verificationScheduler.run(() => runIsolatedTaskWorker<T>(request, signal), signal)
}

/**
 * Verify one current generation in a fresh Worker Thread.
 * @param path - staged or competing current-generation path.
 * @param compression - configured physical encoding.
 * @param expectedId - Session id expected in the decoded header.
 * @param expectedEventCount - exact logical event count expected after decoding.
 * @param expectedPrefix - verified physical prefix; an append tail may be present and is not validated.
 * @param signal - optional cancellation for scheduler wait and Worker execution.
 * @returns stable physical identity and digest observed by the worker.
 */
export function verifyCurrentGenerationInWorker(
  path: string,
  compression: JsonlCompression,
  expectedId: string,
  expectedEventCount: number,
  expectedPrefix?: JsonlExpectedPrefix,
  signal?: AbortSignal,
): Promise<JsonlVerifiedGeneration> {
  return verificationScheduler.run(async () => {
    const outcome = await runIsolatedTaskWorker<unknown>({
      path, compression, expectedId, expectedEventCount,
      ...(expectedPrefix === undefined ? {} : { expectedPrefix }),
    }, signal)
    if (!outcome.ok) throw outcome.error
    if (typeof outcome.payload !== 'object' || outcome.payload === null
      || !('digest' in outcome.payload)) {
      throw new Error('migration verifier returned an invalid response')
    }
    return outcome.payload as unknown as JsonlVerifiedGeneration
  }, signal)
}

function verifierAbortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason
  return reason instanceof Error
    ? reason
    : new Error('migration verifier aborted', { cause: reason })
}
