/**
 * IndexTTS-2.5 engine face: the request client for the local
 * `indextts_server.py` HTTP service plus the resolution helpers its process
 * management needs. The service speaks `POST /tts {text, ref_wav, lang}` and
 * answers wav bytes; it binds its port only after the model is resident, so a
 * reachable health endpoint equals a ready engine.
 * @module @deepseek-ai/dsh-gptsovits-voice/indextts
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/**
 * Detect the GPT-SoVITS synthesis language for one piece of text.
 * Kana → Japanese, hangul → Korean, han → Chinese, everything else → English.
 * (Shared with the IndexTTS dispatcher, which routes only Chinese away from
 * GPT-SoVITS.)
 * @param text the text to be synthesized.
 * @returns the GPT-SoVITS `text_lang` value.
 */
export function detectLang(text: string): string {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'ja'
  if (/\p{Script=Hangul}/u.test(text)) return 'ko'
  if (/\p{Script=Han}/u.test(text)) return 'zh'
  return 'en'
}

/**
 * How one voice profile chooses its engine. `auto` sends Chinese to IndexTTS
 * (native prosody) when both are configured and everything else to GPT-SoVITS;
 * the explicit values force one engine.
 */
export type EnginePreference = 'auto' | 'gptsovits' | 'indextts'

/** The engine a synthesis request actually runs on. */
export type EngineChoice = 'gptsovits' | 'indextts'

/** Everything `resolveEngine` needs to know about the deployment. */
export interface EngineAvailability {
  /** Base URL of the IndexTTS service; empty means IndexTTS is not deployed. */
  indexttsUrl: string
  /** Reference clip of the requesting voice profile for IndexTTS; empty means the profile cannot use it. */
  indexRefAudioPath: string
}

/**
 * Pick the engine for one synthesis request, mirroring VoiceCut's dispatch:
 * `auto` routes Chinese to IndexTTS (native Chinese prosody) when the service
 * and the profile's reference clip both exist; Japanese and English stay on
 * GPT-SoVITS, whose voice is the fine-tuned identity. A forced engine that
 * cannot run throws — the request fails loudly instead of silently changing
 * the voice.
 * @param requested the profile's engine preference.
 * @param textLang the resolved synthesis language (`detectLang` or the profile override).
 * @param availability whether IndexTTS can serve this profile.
 * @returns the engine to synthesize through.
 * @throws when `indextts` is forced but the service or the reference clip is missing.
 */
export function resolveEngine(requested: EnginePreference, textLang: string, availability: EngineAvailability): EngineChoice {
  if (requested === 'gptsovits') return 'gptsovits'
  if (requested === 'indextts') {
    if (availability.indexttsUrl === '') {
      throw new Error('engine indextts was forced but the IndexTTS service is not configured — set indexttsDir')
    }
    if (availability.indexRefAudioPath === '') {
      throw new Error('engine indextts was forced but this voice has no indexRefAudioPath')
    }
    return 'indextts'
  }
  return textLang === 'zh' && availability.indexttsUrl !== '' && availability.indexRefAudioPath !== ''
    ? 'indextts'
    : 'gptsovits'
}

/**
 * Resolve the python interpreter that runs `indextts_server.py`.
 * @param indexttsDir the index-tts checkout root.
 * @param pythonPath the configured interpreter; a non-absolute value falls back to the checkout venv.
 * @returns an existing interpreter path.
 * @throws when no interpreter can be located — the message names the config field.
 */
export function resolveIndexPython(indexttsDir: string, pythonPath: string): string {
  if (pythonPath !== '' && isAbsolute(pythonPath)) return pythonPath
  const venv = process.platform === 'win32'
    ? join(indexttsDir, '.venv', 'Scripts', 'python.exe')
    : join(indexttsDir, '.venv', 'bin', 'python3')
  if (!existsSync(venv)) {
    throw new Error(`gptsovits-voice: no IndexTTS python interpreter at ${venv} — install the index-tts .venv or set indexttsPython`)
  }
  return venv
}

/** The files a usable IndexTTS deployment must contain. */
export interface IndexttsLayout {
  /** Absolute index-tts checkout root (`indextts/` package and `checkpoints/` under it). */
  indexttsDir: string
  /** Absolute path of the `indextts_server.py` script (lives beside the checkout, e.g. VoiceCut's scripts/). */
  serverScript: string
  /** Resolved python interpreter path. */
  python: string
}

/**
 * Validate the IndexTTS deployment up front so a broken configuration fails
 * at load instead of at the first Chinese sentence.
 * @param layout the deployment paths to check.
 * @throws when the inference package, the checkpoints, the server script, or the interpreter is missing.
 */
export function validateIndexttsFiles(layout: IndexttsLayout): void {
  if (!existsSync(join(layout.indexttsDir, 'indextts', 'infer_v2_5.py'))) {
    throw new Error(`gptsovits-voice: indextts/infer_v2_5.py not found under "${layout.indexttsDir}" — set indexttsDir to the index-tts checkout root`)
  }
  if (!existsSync(join(layout.indexttsDir, 'checkpoints', 'config.yaml'))) {
    throw new Error(`gptsovits-voice: checkpoints/config.yaml not found under "${layout.indexttsDir}" — the index-tts checkpoints are missing`)
  }
  if (!existsSync(layout.serverScript)) {
    throw new Error(`gptsovits-voice: indextts_server.py not found at "${layout.serverScript}" — set indexttsServerScript`)
  }
  if (!existsSync(layout.python)) {
    throw new Error(`gptsovits-voice: IndexTTS python interpreter not found at ${layout.python} — set indexttsPython`)
  }
}

/**
 * Synthesize one piece of text through the IndexTTS service.
 * @param url the service base URL (`http://host:port`).
 * @param text the text to be synthesized.
 * @param refWavPath absolute path of the reference wav (as seen by the service process).
 * @param lang synthesis language; the service uppercases it.
 * @param timeoutMs fetch timeout for one synthesis request.
 * @returns the raw wav bytes.
 */
export async function indexttsTts(url: string, text: string, refWavPath: string, lang: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ref_wav: refWavPath, lang: lang.toUpperCase() }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`
    try { detail += `: ${JSON.stringify(await res.json()).slice(0, 300)}` } catch { /* body was not json; the status alone is the message */ }
    throw new Error(detail)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** The ffmpeg argv head that names the piped wav input. */
const FFMPEG_INPUT_ARGS = ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0'] as const
/** The ffmpeg argv tail that encodes mp3 on the piped output. */
const FFMPEG_OUTPUT_ARGS = ['-codec:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'] as const
/** EBU R128 loudness target matching VoiceCut's loudnorm (-16 LUFS, true peak -1.5 dBTP). */
const LOUDNORM_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11'

/**
 * Build the ffmpeg arguments for the wav→mp3 transcode.
 * @param loudnorm whether to normalize loudness to -16 LUFS (keeps the two engines' output levels consistent).
 * @returns the complete ffmpeg argument list for pipe-in/pipe-out transcoding.
 */
export function ffmpegArgs(loudnorm: boolean): string[] {
  const args: string[] = [...FFMPEG_INPUT_ARGS]
  if (loudnorm) args.push('-af', LOUDNORM_FILTER)
  args.push(...FFMPEG_OUTPUT_ARGS)
  return args
}
