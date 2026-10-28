import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { indexttsTts, type EnginePreference } from '../src/indextts.ts'
import { resolveEngine } from '../src/indextts.ts'

const voice = {
  name: 'madoka',
  refAudioPath: 'C:/refs/ref.wav',
  promptText: 'でも、人助けのために頑張るマミさんの姿はとても素敵で……',
  promptLang: 'ja',
  textLang: 'auto',
  auxRefAudioPaths: [],
  engine: 'auto' as EnginePreference,
  indexRefAudioPath: 'C:/refs/index-ref.wav',
}

let origin: Server | undefined

afterEach(async () => {
  if (origin === undefined) return
  const closing = origin
  origin = undefined
  await new Promise<void>(resolve => closing.close(() => { resolve() }))
})

/**
 * Serve canned answers and record every request.
 * @param handler answers each request.
 * @returns the origin URL and the received method/path/body tuples.
 */
async function startOrigin(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, body: string) => void): Promise<{ base: string; hits: { method: string; path: string; body: string }[] }> {
  const hits: { method: string; path: string; body: string }[] = []
  origin = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      hits.push({ method: request.method ?? '', path: request.url ?? '', body: raw })
      handler(request, response, raw)
    })
  })
  await new Promise<void>((resolve) => { origin?.listen(0, '127.0.0.1', resolve) })
  const address = origin.address() as AddressInfo
  return { base: `http://127.0.0.1:${String(address.port)}`, hits }
}

/**
 * A single-flight wake callback mirroring the plugin's keeper wake shape.
 * @param keeperUrl the keeper base URL.
 * @param state the test-side record of concurrent attempts.
 * @returns the wake callback.
 */
function makeWake(keeperUrl: string, state: { inFlight: number; maxConcurrent: number }): () => Promise<void> {
  let pending: Promise<void> | undefined
  return () => {
    if (pending !== undefined) return pending
    const attempt = (async () => {
      state.inFlight++
      state.maxConcurrent = Math.max(state.maxConcurrent, state.inFlight)
      const res = await fetch(`${keeperUrl}/wake`, { method: 'POST' })
      if (!res.ok) throw new Error(`wake failed: HTTP ${String(res.status)}`)
    })()
    pending = attempt
    attempt.then(() => {
      if (pending === attempt) pending = undefined
      state.inFlight--
    }, () => {
      if (pending === attempt) pending = undefined
      state.inFlight--
    })
    return attempt
  }
}

describe('remote IndexTTS wake + synthesis', () => {
  it('single-flights concurrent wakes and synthesizes through the remote URL', async () => {
    const wav = Buffer.from('index-wav-bytes')
    const { base, hits } = await startOrigin((request, response, body) => {
      if (request.url === '/wake') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      expect(JSON.parse(body)).toMatchObject({ text: '你好', ref_wav: voice.indexRefAudioPath, lang: 'ZH' })
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.end(wav)
    })
    const state = { inFlight: 0, maxConcurrent: 0 }
    const wake = makeWake(base, state)

    const [audio] = await Promise.all([
      indexttsTts(base, '你好', voice.indexRefAudioPath, 'zh', 5000),
      wake(),
      wake(),
      wake(),
    ])

    expect(audio.equals(wav)).toBe(true)
    expect(state.maxConcurrent).toBe(1)
    const paths = hits.map(hit => hit.path)
    expect(paths.filter(path => path === '/wake')).toHaveLength(1)
    expect(paths.filter(path => path === '/tts')).toHaveLength(1)
  })

  it('routes Chinese to IndexTTS only when the remote URL and reference clip exist', () => {
    const available = { indexttsUrl: 'http://gpu:9881', indexRefAudioPath: voice.indexRefAudioPath }
    const noUrl = { indexttsUrl: '', indexRefAudioPath: voice.indexRefAudioPath }
    const noRef = { indexttsUrl: 'http://gpu:9881', indexRefAudioPath: '' }
    expect(resolveEngine('auto', 'zh', available)).toBe('indextts')
    expect(resolveEngine('auto', 'zh', noUrl)).toBe('gptsovits')
    expect(resolveEngine('auto', 'zh', noRef)).toBe('gptsovits')
    expect(resolveEngine('auto', 'ja', available)).toBe('gptsovits')
  })
})
