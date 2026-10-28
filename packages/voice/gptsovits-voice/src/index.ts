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
  /**
   * Base URL of an already-running GPT-SoVITS api_v2 (`http://host:port`).
   * Set this to run the bridge on another machine than the engine (the bridge
   * is pure Node plus ffmpeg; the engines are not) — the plugin then spawns
   * nothing and `gptsovitsDir`/`apiPort`/`autostartApi` are ignored.
   */
  remoteGptsovitsUrl?: string
  /**
   * Base URL of an already-running IndexTTS service (`http://host:port`),
   * usually an SSH reverse tunnel to the GPU node. Required together with
   * `remoteGptsovitsUrl`; empty in remote mode keeps IndexTTS off.
   */
  remoteIndexttsUrl?: string
  /**
   * URL of the GPU node's IndexTTS keeper (`POST /wake` starts the engine and
   * returns when the model is resident). Empty means IndexTTS is managed
   * elsewhere and the bridge just hits `remoteIndexttsUrl` directly.
   */
  remoteIndexttsKeeperUrl?: string
  /** Absolute ffmpeg executable for the wav→mp3 transcode; empty uses the bundled ffmpeg-static. */
  ffmpegPath?: string
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
  /**
   * Maximum clauses synthesized together per GPT-SoVITS batch. The engine
   * splits text at punctuation (`cut5`); `1` keeps serial synthesis, higher
   * values trade VRAM for lower multi-clause latency.
   */
  batchSize?: number
  /**
   * Synthesize one short line as soon as a spawned api_v2 answers, so its
   * weights load during profile boot instead of inside the first reply.
   */
  warmup?: boolean
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
  /**
   * Kill the IndexTTS service after this many idle milliseconds to free its
   * ~5 GB; the next Chinese request respawns it (20-40 s model load). `0`
   * keeps it loaded for the profile lifetime.
   */
  indexttsIdleUnloadMs?: number
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
  remoteGptsovitsUrl: z.string().description('Base URL of a remote GPT-SoVITS api_v2; set to run the bridge without spawning engines locally.').default(''),
  remoteIndexttsUrl: z.string().description('Base URL of a remote IndexTTS service (e.g. an SSH tunnel to the GPU node).').default(''),
  remoteIndexttsKeeperUrl: z.string().description('URL of the GPU node IndexTTS keeper; POST /wake starts the engine and waits for readiness.').default(''),
  ffmpegPath: z.string().description('Absolute ffmpeg executable; empty uses the bundled ffmpeg-static.').default(''),
  pythonPath: z.string().description('Python interpreter for api_v2; empty uses the checkout .venv.').default(''),
  host: z.string().description('Host both engines and the bridge bind to.').default('127.0.0.1'),
  apiPort: z.number().description('Port of the GPT-SoVITS api_v2.').default(9880),
  bridgePort: z.number().description('Port of the OpenAI-compatible bridge.').default(9885),
  apiConfigPath: z.string().description('api_v2 TTS config path, relative to gptsovitsDir.').default('GPT_SoVITS/configs/tts_infer_dsh.yaml'),
  autostartApi: z.boolean().description('Spawn api_v2 on profile boot.').default(true),
  apiStartupTimeoutMs: z.number().description('How long to poll for api readiness before logging a timeout.').default(180_000),
  requestTimeoutMs: z.number().description('Fetch timeout for one synthesis request.').default(180_000),
  batchSize: z.number().description('Maximum clauses synthesized together per GPT-SoVITS batch; 1 keeps serial synthesis.').min(1).max(16).default(8),
  warmup: z.boolean().description('Warm the spawned api_v2 model with one short synthesis at boot.').default(true),
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
  indexttsIdleUnloadMs: z.number().description('Kill the IndexTTS service after this many idle milliseconds to free its ~5 GB; 0 keeps it loaded.').default(600_000),
  indexttsStartupTimeoutMs: z.number().description('Startup deadline for the IndexTTS service; the model load takes 20-40s.').default(240_000),
  loudnorm: z.boolean().description('Normalize engine output to -16 LUFS so both voices read at the same level.').default(false),
})

/** Config after schemastery filled every default and the paths are normalized. */
interface ResolvedConfig {
  /** Base URL of a remote GPT-SoVITS api_v2; non-empty switches the plugin to remote mode. */
  remoteGptsovitsUrl: string
  /** Base URL of a remote IndexTTS service; used only in remote mode. */
  remoteIndexttsUrl: string
  /** GPU node IndexTTS keeper URL; empty means the bridge hits remoteIndexttsUrl directly. */
  remoteIndexttsKeeperUrl: string
  /** Absolute ffmpeg executable; empty resolves to the bundled ffmpeg-static binary. */
  ffmpegPath: string
  gptsovitsDir: string
  pythonPath: string
  host: string
  apiPort: number
  bridgePort: number
  apiConfigPath: string
  autostartApi: boolean
  apiStartupTimeoutMs: number
  requestTimeoutMs: number
  batchSize: number
  warmup: boolean
  defaultVoice: string
  voices: Map<string, VoiceProfile>
  indexttsDir: string
  indexttsServerScript: string
  indexttsPython: string
  indexttsPort: number
  autostartIndextts: boolean
  indexttsIdleUnloadMs: number
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
    remoteGptsovitsUrl: (config.remoteGptsovitsUrl ?? '').trim().replace(/\/+$/, ''),
    remoteIndexttsUrl: (config.remoteIndexttsUrl ?? '').trim().replace(/\/+$/, ''),
    remoteIndexttsKeeperUrl: (config.remoteIndexttsKeeperUrl ?? '').trim().replace(/\/+$/, ''),
    ffmpegPath: (config.ffmpegPath ?? '').trim(),
    gptsovitsDir,
    pythonPath: (config.pythonPath ?? '').trim(),
    host: config.host ?? '127.0.0.1',
    apiPort: config.apiPort ?? 9880,
    bridgePort: config.bridgePort ?? 9885,
    apiConfigPath: config.apiConfigPath ?? 'GPT_SoVITS/configs/tts_infer_dsh.yaml',
    autostartApi: config.autostartApi ?? true,
    apiStartupTimeoutMs: config.apiStartupTimeoutMs ?? 180_000,
    requestTimeoutMs: config.requestTimeoutMs ?? 180_000,
    batchSize: config.batchSize ?? 8,
    warmup: config.warmup ?? true,
    defaultVoice: (config.defaultVoice ?? '').trim() || (voices.keys().next().value ?? ''),
    voices,
    indexttsDir,
    // VoiceCut keeps the server script in the parent repo's scripts/ directory.
    indexttsServerScript: configuredScript !== '' ? configuredScript : join(indexttsDir, '..', 'scripts', 'indextts_server.py'),
    indexttsPython: (config.indexttsPython ?? '').trim(),
    indexttsPort: config.indexttsPort ?? 9881,
    autostartIndextts: config.autostartIndextts ?? true,
    indexttsIdleUnloadMs: config.indexttsIdleUnloadMs ?? 600_000,
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
    if (child.exitCode === null && !child.killed) {
      // The venv launcher python.exe wraps the real interpreter as a child;
      // taskkill /T takes the whole tree so the model memory is actually freed.
      if (process.platform === 'win32' && child.pid !== undefined) {
        try {
          spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' })
          return
        } catch { /* fall through to the plain kill */ }
      }
      child.kill()
    }
  }
}

/**
 * Poll for api_v2 readiness in the background and log the outcome; a timeout
 * is an error log, not a throw — the dsh-tts chain degrades per request.
 * @param ctx the plugin fiber context.
 * @param cfg resolved settings.
 * @param stopped set by the api disposer; stops the poll loop.
 * @returns true when the api answered before the deadline or the profile stopped.
 */
async function waitUntilResponsive(ctx: Context, cfg: ResolvedConfig, stopped: { value: boolean }): Promise<boolean> {
  const deadline = Date.now() + cfg.apiStartupTimeoutMs
  const startedAt = Date.now()
  while (Date.now() < deadline) {
    if (stopped.value) return false
    if (await isServing(cfg.host, cfg.apiPort)) {
      ctx.logger.info('gptsovits-voice: api_v2 ready at http://%s:%d (took %ds)', cfg.host, cfg.apiPort, Math.round((Date.now() - startedAt) / 1000))
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!stopped.value) {
    ctx.logger.error('gptsovits-voice: api_v2 not ready after %dms — check the [gptsovits-api] log lines above', cfg.apiStartupTimeoutMs)
  }
  return false
}

/** Text of the one-time warm-up synthesis; its content is irrelevant to the load. */
const WARMUP_TEXT = '你好。'

/** The subset of the plugin logger the warm-up reports through. */
export interface WarmupLog {
  /**
   * Report a completed warm-up.
   * @param format printf-style message.
   * @param values message arguments.
   */
  info(format: string, ...values: unknown[]): void
  /**
   * Report a warm-up that left the model cold.
   * @param format printf-style message.
   * @param values message arguments.
   */
  warn(format: string, ...values: unknown[]): void
}

/** What a spawned api_v2 needs for its one-time model load. */
export interface WarmupSettings {
  /** Whether the operator asked for the warm-up. */
  enabled: boolean
  /** Base URL of the spawned api_v2. */
  apiUrl: string
  /** Voice whose reference clip and transcript drive the warm-up request; undefined when no voice is configured. */
  voice: VoiceProfile | undefined
  /** Fetch timeout for the warm-up request. */
  requestTimeoutMs: number
}

/**
 * Load the api_v2 weights with one short synthesis. api_v2 answers `/` before
 * the model is loaded, so without this the first reply pays the whole load
 * (tens of seconds) inside its own timeout window.
 * @param settings what to synthesize and how long to wait.
 * @param log plugin logger for the outcome.
 * @param stopped set by the api disposer; a result arriving after disposal is ignored.
 * @returns true when the model answered successfully.
 */
export async function warmUpApi(settings: WarmupSettings, log: WarmupLog, stopped: { value: boolean }): Promise<boolean> {
  const { enabled, apiUrl, voice } = settings
  if (!enabled || voice === undefined) return false
  const startedAt = Date.now()
  try {
    const response = await fetch(`${apiUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: WARMUP_TEXT,
        text_lang: 'zh',
        ref_audio_path: voice.refAudioPath,
        prompt_text: voice.promptText,
        prompt_lang: voice.promptLang,
        text_split_method: 'cut5',
        media_type: 'wav',
        streaming_mode: false,
      }),
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
    })
    await response.arrayBuffer()
    if (stopped.value) return false
    if (!response.ok) {
      log.warn('gptsovits-voice: warm-up answered HTTP %d — the first reply may still wait for the model load', response.status)
      return false
    }
    log.info('gptsovits-voice: api_v2 warmed up in %ds (model loaded)', Math.round((Date.now() - startedAt) / 1000))
    return true
  } catch (error) {
    if (!stopped.value) {
      log.warn('gptsovits-voice: warm-up failed (%s) — the first reply pays the model load',
        error instanceof Error ? error.message : String(error))
    }
    return false
  }
}

/**
 * Resolve the ffmpeg executable for the bridge transcode: the configured
 * absolute path wins, else the bundled ffmpeg-static binary, else fail at
 * load — the bridge cannot serve audio without it.
 * @param configured the `ffmpegPath` config value (may be empty).
 * @returns an absolute ffmpeg executable path.
 * @throws when neither the config path nor ffmpeg-static is available.
 */
function resolveFfmpegPath(configured: string): string {
  if (configured !== '') {
    if (!existsSync(configured)) {
      throw new Error(`gptsovits-voice: ffmpegPath not found at ${configured}`)
    }
    return configured
  }
  if (ffmpegStatic) return ffmpegStatic
  throw new Error('gptsovits-voice: no ffmpeg available — install ffmpeg-static or set ffmpegPath')
}

/**
 * Build the bridge-side `ensureIndextts` callback that wakes a remote IndexTTS
 * keeper instead of managing a local child process. The keeper starts the
 * engine and returns only once the model is resident, so concurrent callers
 * share one in-flight POST.
 * @param keeperUrl the keeper base URL (`POST /wake`).
 * @returns the wake callback; rejects when the keeper fails or times out.
 */
function createKeeperWake(keeperUrl: string): () => Promise<void> {
  let inFlight: Promise<void> | undefined
  return () => {
    if (inFlight !== undefined) return inFlight
    const attempt = (async () => {
      const res = await fetch(`${keeperUrl}/wake`, { method: 'POST', signal: AbortSignal.timeout(240_000) })
      if (!res.ok) {
        let detail = `HTTP ${String(res.status)}`
        try { detail += `: ${JSON.stringify(await res.json()).slice(0, 300)}` } catch { /* body was not json; the status alone is the message */ }
        throw new Error(`IndexTTS keeper wake failed (${detail})`)
      }
    })()
    inFlight = attempt
    // Single flight: concurrent syntheses share this attempt; the rejection is
    // delivered through the returned promise, the detached chain only clears
    // the slot.
    attempt.then(() => {
      if (inFlight === attempt) inFlight = undefined
    }, () => {
      if (inFlight === attempt) inFlight = undefined
    })
    return attempt
  }
}

/**
 * Build the bridge settings for the resolved plugin config.
 * @param cfg resolved settings.
 * @param ensureIndextts lazy-start callback; undefined when IndexTTS is unmanaged.
 * @param warn the plugin fiber's warning logger for bridge-side events.
 * @returns the bridge server settings.
 */
function toBridgeConfig(cfg: ResolvedConfig, ensureIndextts: (() => Promise<void>) | undefined,
  warn: (format: string, ...values: unknown[]) => void): BridgeConfig {
  return {
    host: cfg.host,
    port: cfg.bridgePort,
    gptsovitsUrl: `http://${cfg.host}:${String(cfg.apiPort)}`,
    indexttsUrl: cfg.indexttsDir === '' ? '' : `http://${cfg.host}:${String(cfg.indexttsPort)}`,
    ffmpegPath: ffmpegStatic ?? '',
    defaultVoice: cfg.defaultVoice,
    voices: cfg.voices,
    requestTimeoutMs: cfg.requestTimeoutMs,
    batchSize: cfg.batchSize,
    loudnorm: cfg.loudnorm,
    ensureIndextts,
    log: warn,
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

  // Remote mode: the bridge runs beside the model (it is pure Node plus
  // ffmpeg) while the engines stay on the GPU node behind SSH tunnels. The
  // plugin spawns nothing; IndexTTS wake-ups go to the keeper service.
  if (cfg.remoteGptsovitsUrl !== '') {
    if (cfg.gptsovitsDir !== '' || cfg.indexttsDir !== '') {
      ctx.logger.warn('gptsovits-voice: remoteGptsovitsUrl is set — gptsovitsDir/indexttsDir and every local spawn setting are ignored')
    }
    if (cfg.remoteIndexttsUrl === '' && cfg.voices.size > 0) {
      ctx.logger.warn('gptsovits-voice: no remoteIndexttsUrl — every synthesis falls back to the remote GPT-SoVITS engine')
    }
    const ffmpegPath = resolveFfmpegPath(cfg.ffmpegPath)
    const ensureIndextts = cfg.remoteIndexttsKeeperUrl === '' ? undefined : createKeeperWake(cfg.remoteIndexttsKeeperUrl)
    ctx.effect(() => startBridge(ctx, {
      host: cfg.host,
      port: cfg.bridgePort,
      gptsovitsUrl: cfg.remoteGptsovitsUrl,
      indexttsUrl: cfg.remoteIndexttsUrl,
      ffmpegPath,
      defaultVoice: cfg.defaultVoice,
      voices: cfg.voices,
      requestTimeoutMs: cfg.requestTimeoutMs,
      batchSize: cfg.batchSize,
      loudnorm: cfg.loudnorm,
      ensureIndextts,
      log: (format, ...values) => { ctx.logger.warn(format, ...values) },
    }), 'gptsovits-bridge')
    return
  }

  const apiRunning = await isServing(cfg.host, cfg.apiPort)

  if (cfg.autostartApi && !apiRunning) {
    if (cfg.gptsovitsDir === '' || !existsSync(join(cfg.gptsovitsDir, 'api_v2.py'))) {
      throw new Error(`gptsovits-voice: api_v2.py not found under "${cfg.gptsovitsDir}" — set gptsovitsDir or turn off autostartApi`)
    }
    const stopped = { value: false }
    ctx.effect(() => {
      const disposer = spawnApi(ctx, cfg)
      void waitUntilResponsive(ctx, cfg, stopped).then((ready) => {
        if (!ready) return
        return warmUpApi({
          enabled: cfg.warmup,
          apiUrl: `http://${cfg.host}:${String(cfg.apiPort)}`,
          voice: cfg.voices.get(cfg.defaultVoice),
          requestTimeoutMs: cfg.requestTimeoutMs,
        }, ctx.logger, stopped)
      })
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

  // IndexTTS hosting: validate the deployment up front, then either warm the
  // service at boot (autostartIndextts) or let the first Chinese request spawn
  // it lazily. After every request the idle timer re-arms; when it fires the
  // model process is killed and its ~5 GB freed until the next request.
  let ensureIndextts: (() => Promise<void>) | undefined
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
      idleUnloadMs: cfg.indexttsIdleUnloadMs,
    })
    ensureIndextts = () => sidecar.ensureRunning()
    ctx.effect(() => {
      return () => { sidecar.dispose() }
    }, 'indextts-sidecar')
    if (cfg.autostartIndextts) {
      void sidecar.ensureRunning().catch((error: unknown) => {
        ctx.logger.error('IndexTTS startup failed: %s — Chinese requests fall back per bridge engine rules', error instanceof Error ? error.message : String(error))
      })
    } else {
      ctx.logger.info('gptsovits-voice: IndexTTS starts lazily on the first Chinese request and unloads after %dms idle',
        cfg.indexttsIdleUnloadMs)
    }
  }

  ctx.effect(() => startBridge(ctx, toBridgeConfig(cfg, ensureIndextts, (format, ...values) => { ctx.logger.warn(format, ...values) })), 'gptsovits-bridge')
}
