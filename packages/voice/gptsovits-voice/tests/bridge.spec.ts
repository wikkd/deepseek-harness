import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { gptsovitsTts, type BridgeConfig, type VoiceProfile } from '../src/bridge.ts'

const voice: VoiceProfile = {
  name: 'madoka',
  refAudioPath: 'C:/refs/ref.wav',
  promptText: 'でも、人助けのために頑張るマミさんの姿はとても素敵で……',
  promptLang: 'ja',
  textLang: 'auto',
  auxRefAudioPaths: [],
  engine: 'gptsovits',
  indexRefAudioPath: '',
}

/**
 * Build the bridge settings needed by the GPT-SoVITS request path.
 * @param gptsovitsUrl the fake api_v2 origin.
 * @param batchSize clauses synthesized together per batch.
 * @returns complete bridge settings with one voice.
 */
function bridgeConfig(gptsovitsUrl: string, batchSize: number): BridgeConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    gptsovitsUrl,
    indexttsUrl: '',
    ffmpegPath: '',
    defaultVoice: voice.name,
    voices: new Map([[voice.name, voice]]),
    requestTimeoutMs: 5000,
    batchSize,
    loudnorm: false,
  }
}

let server: Server | undefined

afterEach(async () => {
  if (server === undefined) return
  const closing = server
  server = undefined
  await new Promise<void>(resolve => closing.close(() => { resolve() }))
})

/**
 * Serve one canned api_v2 answer and record every request body.
 * @param reply writes the fake synthesis answer.
 * @returns the origin and the received JSON bodies.
 */
async function startApi(reply: (response: import('node:http').ServerResponse) => void): Promise<{ base: string; bodies: string[] }> {
  const bodies: string[] = []
  server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      bodies.push(raw)
      reply(response)
    })
  })
  await new Promise<void>((resolve) => { server?.listen(0, '127.0.0.1', resolve) })
  const address = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${String(address.port)}`, bodies }
}

describe('GPT-SoVITS synthesis request', () => {
  it.each([8, 1])('carries batch_size %i with the api_v2 contract', async (batchSize) => {
    const wav = Buffer.from('wav-bytes')
    const { base, bodies } = await startApi((response) => {
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.end(wav)
    })

    const audio = await gptsovitsTts(bridgeConfig(base, batchSize), '你好，今天过得怎么样？', voice, 'zh', 1)

    expect(audio.equals(wav)).toBe(true)
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
      text: '你好，今天过得怎么样？',
      text_lang: 'zh',
      ref_audio_path: voice.refAudioPath,
      prompt_text: voice.promptText,
      prompt_lang: voice.promptLang,
      aux_ref_audio_paths: [],
      text_split_method: 'cut5',
      batch_size: batchSize,
      speed_factor: 1,
      media_type: 'wav',
      streaming_mode: false,
    })
  })
})
