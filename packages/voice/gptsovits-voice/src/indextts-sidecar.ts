/**
 * Managed IndexTTS server sidecar: spawns VoiceCut's `indextts_server.py` with
 * the index-tts dedicated interpreter when the configured origin is not already
 * serving and kills the child when the profile stops. The script loads the
 * model before binding its port, so a reachable health endpoint means the
 * engine is ready to synthesize.
 * @module @deepseek-ai/dsh-gptsovits-voice/indextts-sidecar
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** The slice of the plugin context the sidecar needs: line-oriented logging. */
export interface SidecarLogger {
  /** Log an informational line. */
  info(format: string, ...values: unknown[]): void
  /** Log a warning line. */
  warn(format: string, ...values: unknown[]): void
  /** Log an error line. */
  error(format: string, ...values: unknown[]): void
}

/** Everything the sidecar needs to own one IndexTTS child process. */
export interface IndexttsSidecarSettings {
  /** Absolute index-tts checkout root; the child runs with it as cwd. */
  indexttsDir: string
  /** Absolute path of `indextts_server.py`. */
  serverScript: string
  /** Resolved python interpreter path. */
  python: string
  /** Model weights directory passed as `--model_dir`. */
  modelDir: string
  /** Host the service binds to. */
  host: string
  /** Port the service binds to. */
  port: number
  /** Base URL probed for readiness (`http://host:port`). */
  url: string
  /** Deadline for one startup poll sequence; the model load alone takes 20-40 s. */
  startupTimeoutMs: number
}

/**
 * Whether anything answers on the origin — any HTTP response counts, because
 * the service answers 404 on `/` while healthy.
 * @param url - probed base URL.
 * @returns true when the endpoint answered.
 */
export async function isServing(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

/**
 * Build the server command line: the VoiceCut-proven launch shape
 * (`indextts_server.py --model_dir <checkpoints> --host <host> --port <port>`).
 * @param settings - sidecar settings.
 * @returns the argv tail after the python executable.
 */
export function buildLaunchArgs(settings: IndexttsSidecarSettings): string[] {
  return [
    settings.serverScript,
    '--model_dir', settings.modelDir,
    '--host', settings.host,
    '--port', String(settings.port),
  ]
}

/**
 * The process launch the sidecar performs: node's `spawn` narrowed to the
 * IndexTTS invocation shape, so tests can substitute a stub launcher.
 */
export type SpawnIndextts = (command: string, args: string[],
  options: { cwd: string; windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess

/** One managed IndexTTS child plus its single-flight startup. */
export interface IndexttsSidecar {
  /**
   * Return when the origin answers, spawning and waiting for readiness once
   * per startup attempt. Concurrent callers share the in-flight attempt; a
   * child that exits clears the attempt so the next call respawns.
   * @throws when startup times out, the child exits first, or the profile is stopping.
   */
  ensureRunning(): Promise<void>
  /** Kill the child (if any) and refuse further startups; the profile disposer owns this. */
  dispose(): void
}

/**
 * Own one IndexTTS child process for the profile lifetime. Construction has no
 * side effects; the first `ensureRunning` (boot warm-up) may spawn.
 * @param logger - the plugin fiber logger; child output is forwarded to it.
 * @param settings - sidecar settings.
 * @param spawnImpl - process launcher; defaults to `node:child_process` spawn.
 * @returns the sidecar handle.
 */
export function createIndexttsSidecar(logger: SidecarLogger, settings: IndexttsSidecarSettings,
  spawnImpl: SpawnIndextts = spawn): IndexttsSidecar {
  let child: ChildProcess | undefined
  let startup: Promise<void> | undefined
  let stopped = false

  /**
   * Forward the child output into the dsh logger, line-buffered.
   * @param childProcess the spawned IndexTTS server process.
   */
  const forwardOutput = (childProcess: ChildProcess): void => {
    const forward = (stream: NodeJS.ReadableStream | null): (() => void) => {
      if (!stream) return () => {}
      let pending = ''
      const on_data = (chunk: Buffer | string): void => {
        pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) logger.info('[indextts] %s', line.trimEnd())
        }
      }
      stream.on('data', on_data)
      return () => { stream.off('data', on_data) }
    }
    forward(childProcess.stdout)
    forward(childProcess.stderr)
  }

  const start = async (): Promise<void> => {
    const spawned = spawnImpl(settings.python, buildLaunchArgs(settings), {
      cwd: settings.indexttsDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = spawned
    logger.info('spawned IndexTTS server (pid %s, %s) — model load takes 20-40s', String(spawned.pid), settings.url)
    forwardOutput(spawned)
    spawned.on('exit', (code, signal) => {
      logger.warn('[indextts] process exited (code=%s signal=%s)', String(code), String(signal))
    })
    const deadline = Date.now() + settings.startupTimeoutMs
    while (Date.now() < deadline) {
      if (stopped) throw new Error('IndexTTS startup aborted: the profile is stopping')
      if (spawned.exitCode !== null) {
        throw new Error(`IndexTTS exited during startup (code ${String(spawned.exitCode)}) — see the [indextts] log lines above`)
      }
      if (await isServing(settings.url)) {
        logger.info('IndexTTS ready at %s', settings.url)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error(`IndexTTS did not become ready at ${settings.url} within ${String(settings.startupTimeoutMs)} ms — see the [indextts] log lines above`)
  }

  return {
    async ensureRunning(): Promise<void> {
      if (stopped) throw new Error('the IndexTTS sidecar is disposed')
      if (await isServing(settings.url)) return
      if (startup !== undefined) return startup
      const attempt = start()
      startup = attempt
      try {
        await attempt
      } finally {
        if (startup === attempt) startup = undefined
      }
    },
    dispose(): void {
      stopped = true
      startup = undefined
      if (child !== undefined && child.exitCode === null && !child.killed) child.kill()
      child = undefined
    },
  }
}
