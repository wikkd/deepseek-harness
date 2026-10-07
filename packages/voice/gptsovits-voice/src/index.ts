/**
 * Sidecar voice stack for cloned voices: hosts the OpenAI-compatible TTS
 * bridge that the dsh-tts `custom` provider calls, and owns the local engine
 * child processes behind it — GPT-SoVITS api_v2 and (when configured) the
 * IndexTTS-2.5 service — spawned when the profile boots and killed when the
 * profile stops, so the voice stack lives and dies with dsh instead of
 * depending on something the operator starts by hand.
 * @module @deepseek-ai/dsh-gptsovits-voice
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import ffmpegStatic from 'ffmpeg-static'
import { startBridge, type BridgeConfig, type VoiceProfile } from './bridge.ts'
import { resolveIndexPython, validateIndexttsFiles, type EnginePreference } from './indextts.ts'
import { createIndexttsSidecar } from './indextts-sidecar.ts'

export { detectLang, resolveEngine, type EngineChoice, type EnginePreference } from './indextts.ts'
export { type BridgeConfig, type VoiceProfile } from './bridge.ts'
export { createIndexttsSidecar, type IndexttsSidecar } from './indextts-sidecar.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'gptsovits-voice'

/** Plugin config: every deployment-specific choice is a field, never a constant. */
export interface Config {
  /** Absolute GPT-SoVITS checkout directory (api_v2.py sits at its root). */
  gptsovitsDir?: string
  /** Python interpreter for api_v2; empty uses `<gptsovitsDir>/.venv/Scripts/python.exe`. */
  pythonPath?: string
  /** Host both api_v2 and the bridge bind to. */
  host?: string
  /** Port of the GPT-SoVITS api_v2. */
  apiPort?: number
  /** Port of the OpenAI-compatible bridge; dsh-tts `customBaseUrl` points here. */
  bridgePort?: number
  /** api_v2 TTS config path, relative to `gptsovitsDir`. */
  apiConfigPath?: string
  /** Spawn api_v2 on profile boot; turn off when GPT-SoVITS is managed elsewhere. */
  autostartApi?: boolean
  /** How long to keep polling for api readiness before logging a timeout. */
  apiStartupTimeoutMs?: number
  /** Fetch timeout for one synthesis request. */
  requestTimeoutMs?: number
  /** Voice used when a request names no profile or an unknown one. */
  defaultVoice?: string
  /** Cloned-voice profiles served by the bridge. */
  voices?: VoiceProfileConfig[]
  /** Absolute index-tts checkout root; empty disables the IndexTTS engine. */
  indexttsDir?: string
  /** Absolute path of `indextts_server.py`; empty resolves to `<indexttsDir>/../scripts/indextts_server.py` (VoiceCut layout). */
  indexttsServerScript?: string
  /** Python interpreter for the IndexTTS service; empty uses `<indexttsDir>/.venv`. */
  indexttsPython?: string
  /** Port of the IndexTTS service. */
  indexttsPort?: number
  /** Spawn the IndexTTS service on profile boot and wait for its model load. */
  autostartIndextts?: boolean
  /** Startup deadline for the IndexTTS service; the model load alone takes 20-40s. */
  indexttsStartupTimeoutMs?: number
  /** Normalize engine output to -16 LUFS so both voices read at the same level. */
  loudnorm?: boolean
}

/** One cloned-voice profile as the user writes it in cordis.yml. */
export interface VoiceProfileConfig {
  /** Profile name the dsh-tts chain entry refers to as `voice`. */
  name: string
  /** Absolute path (as seen by the GPT-SoVITS process) of the 3-10 s reference wav. */
  refAudioPath: string
  /** Exact transcript of the reference clip. */
  promptText: string
  /** Language of the reference clip (ja, zh, en, ...). */
  promptLang: string
  /** Force the synthesis language; `auto` detects kana/hangul/han/latin per request. */
  textLang?: string
  /** Extra reference clips for multi-reference tone fusion. */
  auxRefAudioPaths?: string[]
  /** Engine preference; `auto` sends Chinese to IndexTTS when available. */
  engine?: string
  /** Absolute path of the profile's IndexTTS reference wav; empty keeps the profile on GPT-SoVITS. */
  indexRefAudioPath?: string
}

export const Config: z<Config> = z.object({
  gptsovitsDir: z.string().description('Absolute GPT-SoVITS checkout directory (api_v2.py sits at its root).').default(''),
  pythonPath: z.string().description('Python interpreter for api_v2; empty uses the checkout .venv.').default(''),
  host: z.string().description('Host both engines and the bridge bind to.').default('127.0.0.1'),
  apiPort: z.number().description('Port of the GPT-SoVITS api_v2.').default(9880),
  bridgePort: z.number().description('Port of the OpenAI-compatible bridge.').default(9885),
  apiConfigPath: z.string().description('api_v2 TTS config path, relative to gptsovitsDir.').default('GPT_SoVITS/configs/tts_infer_dsh.yaml'),
  autostartApi: z.boolean().description('Spawn api_v2 on profile boot.').default(true),
  apiStartupTimeoutMs: z.number().description('How long to poll for api readiness before logging a timeout.').default(180_000),
  requestTimeoutMs: z.number().description('Fetch timeout for one synthesis request.').default(180_000),
  defaultVoice: z.string().description('Voice used when a request names no profile or an unknown one.').default(''),
  voices: z.array(z.object({
    name: z.string(),
    refAudioPath: z.string(),
    promptText: z.string(),
    promptLang: z.string(),
    textLang: z.string().default('auto'),
    auxRefAudioPaths: z.array(z.string()).default([]),
    engine: z.string().default('auto'),
    indexRefAudioPath: z.string().default(''),
  })).default([]),
  indexttsDir: z.string().description('Absolute index-tts checkout root; empty disables the IndexTTS engine.').default(''),
  indexttsServerScript: z.string().description('Absolute path of indextts_server.py; empty resolves beside the checkout (VoiceCut layout).').default(''),
  indexttsPython: z.string().description('Python interpreter for the IndexTTS service; empty uses the checkout .venv.').default(''),
  indexttsPort: z.number().description('Port of the IndexTTS service.').default(9881),
  autostartIndextts: z.boolean().description('Spawn the IndexTTS service on profile boot and wait for its model load.').default(true),
  indexttsStartupTimeoutMs: z.number().description('Startup deadline for the IndexTTS service; the model load takes 20-40s.').default(240_000),
  loudnorm: z.boolean().description('Normalize engine output to -16 LUFS so both voices read at the same level.').default(false),
})

/** Config after schemastery filled every default and the paths are normalized. */
interface ResolvedConfig {
  gptsovitsDir: string
  pythonPath: string
  host: string
  apiPort: number
  bridgePort: number
  apiConfigPath: string
  autostartApi: boolean
  apiStartupTimeoutMs: number
  requestTimeoutMs: number
  defaultVoice: string
  voices: Map<string, VoiceProfile>
  indexttsDir: string
  indexttsServerScript: string
  indexttsPython: string
  indexttsPort: number
  autostartIndextts: boolean
  indexttsStartupTimeoutMs: number
  loudnorm: boolean
}

/** The engine preferences a voice profile may request. */
const ENGINE_PREFERENCES: readonly EnginePreference[] = ['auto', 'gptsovits', 'indextts']

/**
 * Fill defaults and normalize user-supplied paths (Windows paths arrive with
 * backslashes or mixed separators; the bridge only compares what it builds).
 * @param config the raw plugin config with defaults already applied.
 * @returns the resolved settings, with voices keyed by name.
 */
function resolveConfig(config: Config): ResolvedConfig {
  const voices = new Map<string, VoiceProfile>()
  for (const voice of config.voices ?? []) {
    const name = typeof voice.name === 'string' ? voice.name.trim() : ''
    if (name === '') continue
    const engine = ENGINE_PREFERENCES.find(candidate => candidate === voice.engine) ?? 'auto'
    voices.set(name, {
      name,
      refAudioPath: typeof voice.refAudioPath === 'string' ? voice.refAudioPath : '',
      promptText: typeof voice.promptText === 'string' ? voice.promptText : '',
      promptLang: typeof voice.promptLang === 'string' ? voice.promptLang : '',
      textLang: typeof voice.textLang === 'string' && voice.textLang !== '' ? voice.textLang : 'auto',
      auxRefAudioPaths: Array.isArray(voice.auxRefAudioPaths) ? voice.auxRefAudioPaths : [],
      engine,
      indexRefAudioPath: typeof voice.indexRefAudioPath === 'string' ? voice.indexRefAudioPath : '',
    })
  }
  const gptsovitsDir = (config.gptsovitsDir ?? '').trim()
  const indexttsDir = (config.indexttsDir ?? '').trim()
  const configuredScript = (config.indexttsServerScript ?? '').trim()
  return {
    gptsovitsDir,
    pythonPath: (config.pythonPath ?? '').trim(),
    host: config.host ?? '127.0.0.1',
    apiPort: config.apiPort ?? 9880,
    bridgePort: config.bridgePort ?? 9885,
    apiConfigPath: config.apiConfigPath ?? 'GPT_SoVITS/configs/tts_infer_dsh.yaml',
    autostartApi: config.autostartApi ?? true,
    apiStartupTimeoutMs: config.apiStartupTimeoutMs ?? 180_000,
    requestTimeoutMs: config.requestTimeoutMs ?? 180_000,
    defaultVoice: (config.defaultVoice ?? '').trim() || (voices.keys().next().value ?? ''),
    voices,
    indexttsDir,
    // VoiceCut keeps the server script in the parent repo's scripts/ directory.
    indexttsServerScript: configuredScript !== '' ? configuredScript : join(indexttsDir, '..', 'scripts', 'indextts_server.py'),
    indexttsPython: (config.indexttsPython ?? '').trim(),
    indexttsPort: config.indexttsPort ?? 9881,
    autostartIndextts: config.autostartIndextts ?? true,
    indexttsStartupTimeoutMs: config.indexttsStartupTimeoutMs ?? 240_000,
    loudnorm: config.loudnorm ?? false,
  }
}

/**
 * Whether anything answers on `http://host:port` — any HTTP response counts,
 * because GPT-SoVITS answers 404 on `/` while healthy.
 * @param host the host to probe.
 * @param port the port to probe.
 * @returns true when the endpoint answered.
 */
async function isServing(host: string, port: number): Promise<boolean> {
  try {
    await fetch(`http://${host}:${String(port)}/`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

/**
 * Forward the api_v2 child output into the dsh logger, line-buffered.
 * @param ctx the plugin fiber context.
 * @param child the api_v2 process.
 * @returns the disposer detaching the output listeners.
 */
function forwardOutput(ctx: Context, child: ChildProcess): () => void {
  const forward = (stream: NodeJS.ReadableStream | null): (() => void) => {
    if (!stream) return () => {}
    let pending = ''
    const on_data = (chunk: Buffer | string): void => {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) ctx.logger.info('[gptsovits-api] %s', line.trimEnd())
      }
    }
    stream.on('data', on_data)
    return () => { stream.off('data', on_data) }
  }
  const disposeOut = forward(child.stdout)
  const disposeErr = forward(child.stderr)
  return () => { disposeOut(); disposeErr() }
}

/**
 * Spawn the GPT-SoVITS api_v2 child process.
 * @param ctx the plugin fiber context.
 * @param cfg resolved settings.
 * @returns the disposer killing the child (and silencing its output).
 */
function spawnApi(ctx: Context, cfg: ResolvedConfig): () => void {
  const python = cfg.pythonPath !== '' && isAbsolute(cfg.pythonPath)
    ? cfg.pythonPath
    : join(cfg.gptsovitsDir, '.venv', 'Scripts', 'python.exe')
  if (!existsSync(python)) {
    throw new Error(`gptsovits-voice: python interpreter not found at ${python} — install the GPT-SoVITS .venv or set pythonPath`)
  }
  const child = spawn(python, [
    'api_v2.py', '-a', cfg.host, '-p', String(cfg.apiPort), '-c', cfg.apiConfigPath,
  ], { cwd: cfg.gptsovitsDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  ctx.logger.info('gptsovits-voice: spawned api_v2 (pid %s, port %d)', String(child.pid), cfg.apiPort)
  const disposeOutput = forwardOutput(ctx, child)
  child.on('exit', (code, signal) => {
    ctx.logger.warn('gptsovits-voice: api_v2 exited (code=%s signal=%s)', String(code), String(signal))
  })
  return () => {
    disposeOutput()
    if (child.exitCode === null && !child.killed) child.kill()
  }
}

/**
 * Poll for api_v2 readiness in the background and log the outcome; a timeout
 * is an error log, not a throw — the dsh-tts chain degrades per request.
 * @param ctx the plugin fiber context.
 * @param cfg resolved settings.
 * @param stopped set by the api disposer; stops the poll loop.
 */
async function waitUntilResponsive(ctx: Context, cfg: ResolvedConfig, stopped: { value: boolean }): Promise<void> {
  const deadline = Date.now() + cfg.apiStartupTimeoutMs
  const startedAt = Date.now()
  while (Date.now() < deadline) {
    if (stopped.value) return
    if (await isServing(cfg.host, cfg.apiPort)) {
      ctx.logger.info('gptsovits-voice: api_v2 ready at http://%s:%d (took %ds)', cfg.host, cfg.apiPort, Math.round((Date.now() - startedAt) / 1000))
      return
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!stopped.value) {
    ctx.logger.error('gptsovits-voice: api_v2 not ready after %dms — check the [gptsovits-api] log lines above', cfg.apiStartupTimeoutMs)
  }
}

/**
 * Build the bridge settings for the resolved plugin config.
 * @param cfg resolved settings.
 * @returns the bridge server settings.
 */
function toBridgeConfig(cfg: ResolvedConfig): BridgeConfig {
  return {
    host: cfg.host,
    port: cfg.bridgePort,
    gptsovitsUrl: `http://${cfg.host}:${String(cfg.apiPort)}`,
    indexttsUrl: cfg.indexttsDir === '' ? '' : `http://${cfg.host}:${String(cfg.indexttsPort)}`,
    ffmpegPath: ffmpegStatic ?? '',
    defaultVoice: cfg.defaultVoice,
    voices: cfg.voices,
    requestTimeoutMs: cfg.requestTimeoutMs,
    loudnorm: cfg.loudnorm,
  }
}

/**
 * Plugin entry: spawn api_v2 (when asked to and not already running), host the
 * bridge, and tie both to the profile lifecycle. Registering the api effect
 * first makes disposal LIFO close the bridge before the engine processes die.
 * @param ctx the plugin fiber context.
 * @param config the plugin config with defaults applied.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const cfg = resolveConfig(config)
  const apiRunning = await isServing(cfg.host, cfg.apiPort)

  if (cfg.autostartApi && !apiRunning) {
    if (cfg.gptsovitsDir === '' || !existsSync(join(cfg.gptsovitsDir, 'api_v2.py'))) {
      throw new Error(`gptsovits-voice: api_v2.py not found under "${cfg.gptsovitsDir}" — set gptsovitsDir or turn off autostartApi`)
    }
    const stopped = { value: false }
    ctx.effect(() => {
      const disposer = spawnApi(ctx, cfg)
      void waitUntilResponsive(ctx, cfg, stopped)
      return () => { stopped.value = true; disposer() }
    }, 'gptsovits-api')
  } else if (apiRunning) {
    ctx.logger.info('gptsovits-voice: api_v2 already serving at http://%s:%d — reusing it', cfg.host, cfg.apiPort)
  } else {
    ctx.logger.warn('gptsovits-voice: autostart disabled and nothing serves http://%s:%d — the bridge answers 502 until GPT-SoVITS is up', cfg.host, cfg.apiPort)
  }

  if (cfg.voices.size === 0) {
    ctx.logger.warn('gptsovits-voice: no voices configured — every synthesis request will be rejected until the voices config lists one')
  }

  // The IndexTTS service loads its model before binding the port, so the boot
  // warm-up waits out the full 20-40s load; dsh-tts's per-request cloud timeout
  // (profile: 60s) cannot absorb a cold start mid-conversation.
  if (cfg.indexttsDir !== '') {
    validateIndexttsFiles({
      indexttsDir: cfg.indexttsDir,
      serverScript: cfg.indexttsServerScript,
      python: resolveIndexPython(cfg.indexttsDir, cfg.indexttsPython),
    })
    const python = resolveIndexPython(cfg.indexttsDir, cfg.indexttsPython)
    const sidecar = createIndexttsSidecar(ctx.logger, {
      indexttsDir: cfg.indexttsDir,
      serverScript: cfg.indexttsServerScript,
      python,
      modelDir: join(cfg.indexttsDir, 'checkpoints'),
      host: cfg.host,
      port: cfg.indexttsPort,
      url: `http://${cfg.host}:${String(cfg.indexttsPort)}`,
      startupTimeoutMs: cfg.indexttsStartupTimeoutMs,
    })
    ctx.effect(() => {
      return () => { sidecar.dispose() }
    }, 'indextts-sidecar')
    if (cfg.autostartIndextts) {
      void sidecar.ensureRunning().catch((error: unknown) => {
        ctx.logger.error('IndexTTS startup failed: %s — Chinese requests fall back per bridge engine rules', error instanceof Error ? error.message : String(error))
      })
    } else {
      ctx.logger.info('gptsovits-voice: IndexTTS autostart disabled — the first Chinese request pays the model load')
    }
  }

  ctx.effect(() => startBridge(ctx, toBridgeConfig(cfg)), 'gptsovits-bridge')
}
