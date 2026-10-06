/**
 * Managed local ComfyUI server: spawns `main.py` from a configured checkout
 * when the configured origin is a loopback http endpoint and not already
 * serving, waits for readiness, and kills the child when the profile stops.
 * Generation awaits the same single-flight startup, so a server that dies
 * between renders is respawned on the next picture instead of failing the
 * tool for the rest of the session.
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The slice of the plugin context the sidecar needs: line-oriented logging. */
export interface SidecarLogger {
  /** Log an informational line. */
  info(format: string, ...values: unknown[]): void
  /** Log a warning line. */
  warn(format: string, ...values: unknown[]): void
  /** Log an error line. */
  error(format: string, ...values: unknown[]): void
}

/** Everything the sidecar needs to own one ComfyUI child process. */
export interface SidecarSettings {
  /** Absolute ComfyUI checkout directory (`main.py` sits at its root). */
  comfyuiDir: string
  /** Python interpreter; empty resolves to `<comfyuiDir>/python_embeded/python.exe`. */
  pythonPath: string
  /** Probed origin, without a trailing slash. */
  origin: string
  /** Host passed to `--listen`. */
  host: string
  /** Port passed to `--port`. */
  port: number
  /** Deadline for one startup poll sequence. */
  startupTimeoutMs: number
  /** Extra CLI arguments appended verbatim (whitespace-split). */
  extraArgs: string
}

/** Hosts a managed ComfyUI child can legally bind; anything else is remote. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Extract the listen target from the configured ComfyUI origin.
 * @param comfyuiUrl - configured origin, e.g. `http://127.0.0.1:8188`.
 * @returns host and port for a loopback http origin, otherwise undefined
 * (malformed URL, non-http scheme, or a remote host a child cannot bind).
 */
export function parseLoopbackOrigin(comfyuiUrl: string): { host: string; port: number } | undefined {
  let url: URL
  try {
    url = new URL(comfyuiUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:') return undefined
  if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined
  return { host: url.hostname, port: url.port === '' ? 80 : Number(url.port) }
}

/**
 * Resolve the python interpreter that runs `main.py`.
 * @param settings - sidecar settings.
 * @returns the configured interpreter when set, else the portable-layout
 * `python_embeded` binary inside the checkout.
 * @throws when neither exists — the message names the config field to set.
 */
export function resolvePythonExecutable(settings: SidecarSettings): string {
  if (settings.pythonPath !== '') {
    if (!existsSync(settings.pythonPath)) {
      throw new Error(`ComfyUI python interpreter not found at "${settings.pythonPath}" — fix comfyuiPythonPath`)
    }
    return settings.pythonPath
  }
  const portable = join(settings.comfyuiDir, 'python_embeded', process.platform === 'win32' ? 'python.exe' : 'python3')
  if (existsSync(portable)) return portable
  throw new Error(`no python_embeded interpreter under "${settings.comfyuiDir}" — set comfyuiPythonPath to the python that runs ComfyUI`)
}

/**
 * Build the ComfyUI command line: the user-proven launch shape
 * (`main.py --listen <host> --port <port>`) plus any configured extras.
 * @param settings - sidecar settings.
 * @returns the argv tail after the python executable.
 */
export function buildLaunchArgs(settings: SidecarSettings): string[] {
  const args = ['main.py', '--listen', settings.host, '--port', String(settings.port)]
  const extra = settings.extraArgs.trim()
  if (extra !== '') args.push(...extra.split(/\s+/u))
  return args
}

/**
 * Whether anything answers on the origin — any HTTP response counts, because
 * ComfyUI answers its UI on `/` while healthy.
 * @param origin - probed origin without a trailing slash.
 * @returns true when the origin answered.
 */
export async function isServing(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

/**
 * Validate the checkout and interpreter up front so a broken sidecar
 * configuration fails at load instead of at the first picture.
 * @param settings - sidecar settings.
 * @throws when `main.py` is missing or no python interpreter resolves.
 */
export function validateSidecarFiles(settings: SidecarSettings): void {
  if (!existsSync(join(settings.comfyuiDir, 'main.py'))) {
    throw new Error(`main.py not found under "${settings.comfyuiDir}" — set comfyuiDir to the ComfyUI checkout root`)
  }
  resolvePythonExecutable(settings)
}

/**
 * The process launch the sidecar performs: node's `spawn` narrowed to the
 * ComfyUI invocation shape, so tests can substitute a stub launcher.
 */
export type SpawnComfyui = (command: string, args: string[],
  options: { cwd: string; windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess

/** One managed ComfyUI child plus its single-flight startup. */
export interface ComfyuiSidecar {
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
 * Own one ComfyUI child process for the profile lifetime. Construction has no
 * side effects; the first `ensureRunning` (boot or first render) may spawn.
 * @param logger - the plugin fiber logger; child output is forwarded to it.
 * @param settings - sidecar settings.
 * @param spawnImpl - process launcher; defaults to `node:child_process` spawn.
 * @returns the sidecar handle.
 */
export function createComfyuiSidecar(logger: SidecarLogger, settings: SidecarSettings,
  spawnImpl: SpawnComfyui = spawn): ComfyuiSidecar {
  let child: ChildProcess | undefined
  let startup: Promise<void> | undefined
  let stopped = false

  /**
   * Forward the child output into the dsh logger, line-buffered.
   * @param childProcess the spawned ComfyUI process.
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
          if (line.trim()) logger.info('[comfyui] %s', line.trimEnd())
        }
      }
      stream.on('data', on_data)
      return () => { stream.off('data', on_data) }
    }
    forward(childProcess.stdout)
    forward(childProcess.stderr)
  }

  const start = async (): Promise<void> => {
    const python = resolvePythonExecutable(settings)
    const spawned = spawnImpl(python, buildLaunchArgs(settings), {
      cwd: settings.comfyuiDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = spawned
    logger.info('spawned ComfyUI (pid %s, %s)', String(spawned.pid), settings.origin)
    forwardOutput(spawned)
    spawned.on('exit', (code, signal) => {
      logger.warn('[comfyui] process exited (code=%s signal=%s)', String(code), String(signal))
    })
    const deadline = Date.now() + settings.startupTimeoutMs
    while (Date.now() < deadline) {
      if (stopped) throw new Error('ComfyUI startup aborted: the profile is stopping')
      if (spawned.exitCode !== null) {
        throw new Error(`ComfyUI exited during startup (code ${String(spawned.exitCode)}) — see the [comfyui] log lines above`)
      }
      if (await isServing(settings.origin)) {
        logger.info('ComfyUI ready at %s', settings.origin)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`ComfyUI did not become ready at ${settings.origin} within ${String(settings.startupTimeoutMs)} ms — see the [comfyui] log lines above`)
  }

  return {
    async ensureRunning(): Promise<void> {
      if (stopped) throw new Error('the ComfyUI sidecar is disposed')
      if (await isServing(settings.origin)) return
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
