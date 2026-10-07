/**
 * OpenAI-compatible TTS bridge: accepts `POST /v1/audio/speech` in the exact
 * shape the dsh-tts `custom` provider sends (`{model, input, voice,
 * response_format}`), synthesizes through the configured engines, transcodes
 * the wav answer to mp3 with the bundled ffmpeg, and answers `audio/mpeg` —
 * the media type dsh-tts assumes for every custom response regardless of what
 * the engine produced.
 *
 * Two engines: GPT-SoVITS api_v2 (the fine-tuned voice identity, ja/en) and
 * the local IndexTTS-2.5 service (native Chinese prosody). Each request picks
 * one via the voice profile's engine preference and the text language.
 * @module @deepseek-ai/dsh-gptsovits-voice/bridge
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { detectLang, ffmpegArgs, indexttsTts, resolveEngine,
  type EngineAvailability, type EnginePreference } from './indextts.ts'

/** One cloned-voice profile: the reference clips both engines speak through. */
export interface VoiceProfile {
  /** Profile name the dsh-tts chain entry refers to as `voice`. */
  name: string
  /** Absolute path (as seen by the GPT-SoVITS process) of the 3-10 s reference wav. */
  refAudioPath: string
  /** Exact transcript of the reference clip. */
  promptText: string
  /** Language of the reference clip (ja, zh, en, ...). */
  promptLang: string
  /** Force the synthesis language; `auto` detects kana/hangul/han/latin per request. */
  textLang: string
  /** Extra reference clips for multi-reference tone fusion. */
  auxRefAudioPaths: string[]
  /** Engine preference; `auto` sends Chinese to IndexTTS when available. */
  engine: EnginePreference
  /** Absolute path of the profile's IndexTTS reference wav; empty keeps the profile on GPT-SoVITS. */
  indexRefAudioPath: string
}

/** Bridge server settings, already resolved from plugin config. */
export interface BridgeConfig {
  /** Host the bridge binds to. */
  host: string
  /** Port the bridge listens on; dsh-tts `customBaseUrl` points here. */
  port: number
  /** Base URL of the local GPT-SoVITS api_v2 (`http://host:port`). */
  gptsovitsUrl: string
  /** Base URL of the local IndexTTS service; empty means IndexTTS is not deployed. */
  indexttsUrl: string
  /** Absolute path of the ffmpeg executable used for the wav→mp3 transcode. */
  ffmpegPath: string
  /** Voice used when a request names no profile or an unknown one. */
  defaultVoice: string
  /** Cloned-voice profiles keyed by name. */
  voices: Map<string, VoiceProfile>
  /** Fetch timeout for one synthesis request. */
  requestTimeoutMs: number
  /** Normalize loudness to -16 LUFS so the two engines' output levels match. */
  loudnorm: boolean
}

/** OpenAI audio-speech request body; only the fields the bridge consumes. */
interface SpeechRequest {
  input?: unknown
  voice?: unknown
  speed?: unknown
}

/**
 * Read the request body up to `limit` bytes.
 * @param req the incoming request.
 * @param limit maximum accepted body size.
 * @returns the raw body bytes.
 */
function readBody(req: IncomingMessage, limit = 512 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

/**
 * Write one JSON response and end it.
 * @param res the response to write.
 * @param code the HTTP status code.
 * @param payload the JSON body.
 */
function writeJson(res: ServerResponse, code: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * Transcode wav bytes to mp3 with the bundled ffmpeg.
 * @param ffmpegPath absolute ffmpeg executable path.
 * @param wav the wav bytes produced by the engine.
 * @param loudnorm whether to normalize loudness to -16 LUFS.
 * @returns the mp3 bytes.
 */
function ffmpegToMp3(ffmpegPath: string, wav: Buffer, loudnorm: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ffmpegArgs(loudnorm), { windowsHide: true })
    const out: Buffer[] = []
    let stderr = ''
    ff.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    ff.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    ff.on('error', reject)
    ff.on('close', (code) => {
      const mp3 = Buffer.concat(out)
      if (code === 0 && mp3.length > 0) resolve(mp3)
      else reject(new Error(`ffmpeg exit ${String(code)}: ${stderr.slice(0, 300)}`))
    })
    ff.stdin.end(wav)
  })
}

/**
 * Synthesize one piece of text through the GPT-SoVITS api_v2 `/tts` endpoint.
 * @param cfg resolved bridge settings.
 * @param text the text to be synthesized.
 * @param profile the voice profile supplying the reference clip.
 * @param textLang the resolved synthesis language.
 * @param speed playback speed factor (clamped by the caller).
 * @returns the raw wav bytes.
 */
async function gptsovitsTts(cfg: BridgeConfig, text: string, profile: VoiceProfile, textLang: string, speed: number): Promise<Buffer> {
  const res = await fetch(`${cfg.gptsovitsUrl}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      text_lang: textLang,
      ref_audio_path: profile.refAudioPath,
      prompt_text: profile.promptText,
      prompt_lang: profile.promptLang,
      aux_ref_audio_paths: profile.auxRefAudioPaths,
      text_split_method: 'cut5',
      speed_factor: speed,
      media_type: 'wav',
      streaming_mode: false,
    }),
    signal: AbortSignal.timeout(cfg.requestTimeoutMs),
  })
  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`
    try { detail += `: ${JSON.stringify(await res.json()).slice(0, 300)}` } catch { /* body was not json; the status alone is the message */ }
    throw new Error(detail)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Handle one bridge request.
 * @returns false when the path is unknown (the caller answers 404).
 */
async function handle(cfg: BridgeConfig, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/health') {
    let gptsovitsReachable = false
    try {
      await fetch(cfg.gptsovitsUrl, { signal: AbortSignal.timeout(1500) })
      gptsovitsReachable = true
    } catch { /* api_v2 not up yet; the health answer is still valid */ }
    writeJson(res, 200, {
      ok: true, gptsovitsReachable, indexttsUrl: cfg.indexttsUrl,
      voices: [...cfg.voices.keys()], defaultVoice: cfg.defaultVoice,
    })
    return true
  }

  if (req.method === 'POST' && (url.pathname === '/v1/audio/speech' || url.pathname === '/audio/speech')) {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as SpeechRequest
    const text = typeof body.input === 'string' ? body.input.trim() : ''
    if (!text) {
      writeJson(res, 400, { error: { message: 'input is required' } })
      return true
    }
    const requested = typeof body.voice === 'string' && body.voice ? body.voice : cfg.defaultVoice
    const profile = cfg.voices.get(requested)
    if (!profile) {
      writeJson(res, 400, { error: { message: `unknown voice: ${requested}` } })
      return true
    }
    const textLang = profile.textLang !== '' && profile.textLang !== 'auto' ? profile.textLang : detectLang(text)
    const availability: EngineAvailability = {
      indexttsUrl: cfg.indexttsUrl,
      indexRefAudioPath: profile.indexRefAudioPath,
    }
    const engine = resolveEngine(profile.engine, textLang, availability)
    const speed = Math.min(2, Math.max(0.5, typeof body.speed === 'number' ? body.speed : 1))
    const wav = engine === 'indextts'
      ? await indexttsTts(cfg.indexttsUrl, text, profile.indexRefAudioPath, textLang, cfg.requestTimeoutMs)
      : await gptsovitsTts(cfg, text, profile, textLang, speed)
    if (wav.length < 64) throw new Error(`${engine} produced empty audio`)
    const mp3 = await ffmpegToMp3(cfg.ffmpegPath, wav, cfg.loudnorm)
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': mp3.length })
    res.end(mp3)
    return true
  }

  return false
}

/**
 * Start the bridge HTTP server.
 * @param ctx the plugin fiber context; used for logging only.
 * @param cfg resolved bridge settings.
 * @returns the disposer closing the server.
 */
export function startBridge(ctx: Context, cfg: BridgeConfig): () => void {
  const server: Server = createServer((req, res) => {
    void handle(cfg, req, res).then((known) => {
      if (!known) writeJson(res, 404, { error: { message: 'not found' } })
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error('gptsovits-voice: bridge request failed: %s', message)
      writeJson(res, 502, { error: { message } })
    })
  })
  server.on('error', (error: Error) => {
    ctx.logger.error('gptsovits-voice: bridge server error: %s', error.message)
  })
  server.listen(cfg.port, cfg.host)
  ctx.logger.info('gptsovits-voice: bridge on http://%s:%d/v1/audio/speech (voices: %s; indextts: %s)',
    cfg.host, String(cfg.port), [...cfg.voices.keys()].join(', ') || 'none', cfg.indexttsUrl === '' ? 'off' : cfg.indexttsUrl)
  return () => { server.close() }
}
