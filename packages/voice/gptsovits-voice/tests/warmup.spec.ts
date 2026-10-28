import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceProfile } from '../src/bridge.ts'
import { warmUpApi, type WarmupLog } from '../src/index.ts'

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

interface LogLine {
  level: 'info' | 'warn'
  message: string
}

function recordingLog(): { log: WarmupLog; lines: LogLine[] } {
  const lines: LogLine[] = []
  const format = (template: string, values: unknown[]): string => {
    let index = 0
    return template.replace(/%[sd]/gu, () => String(values[index++]))
  }
  return {
    lines,
    log: {
      info: (template, ...values) => { lines.push({ level: 'info', message: format(template, values) }) },
      warn: (template, ...values) => { lines.push({ level: 'warn', message: format(template, values) }) },
    },
  }
}

let server: Server | undefined

afterEach(async () => {
  if (server === undefined) return
  const closing = server
  server = undefined
  await new Promise<void>(resolve => closing.close(() => { resolve() }))
})

async function startServer(reply: (raw: string, response: import('node:http').ServerResponse) => void): Promise<{ base: string; bodies: string[] }> {
  const bodies: string[] = []
  server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      bodies.push(raw)
      reply(raw, response)
    })
  })
  await new Promise<void>((resolve) => { server?.listen(0, '127.0.0.1', resolve) })
  const address = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${String(address.port)}`, bodies }
}

describe('api_v2 warm-up', () => {
  it('synthesizes one short line with the default voice and reports the load time', async () => {
    const { base, bodies } = await startServer((_raw, response) => {
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.end('wav-bytes')
    })
    const { log, lines } = recordingLog()

    const warm = await warmUpApi({ enabled: true, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, { value: false })

    expect(warm).toBe(true)
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
      text: '你好。',
      text_lang: 'zh',
      ref_audio_path: voice.refAudioPath,
      prompt_text: voice.promptText,
      prompt_lang: voice.promptLang,
      text_split_method: 'cut5',
      media_type: 'wav',
      streaming_mode: false,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ level: 'info' })
    expect(lines[0]?.message).toContain('warmed up')
  })

  it('skips the request when warm-up is off or no voice is configured', async () => {
    const { base, bodies } = await startServer((_raw, response) => { response.writeHead(200); response.end() })
    const { log, lines } = recordingLog()

    expect(await warmUpApi({ enabled: false, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, { value: false })).toBe(false)
    expect(await warmUpApi({ enabled: true, apiUrl: base, voice: undefined, requestTimeoutMs: 5000 }, log, { value: false })).toBe(false)
    expect(bodies).toHaveLength(0)
    expect(lines).toHaveLength(0)
  })

  it('reports an unsuccessful answer without failing the plugin', async () => {
    const { base } = await startServer((_raw, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end('{"error":"model missing"}')
    })
    const { log, lines } = recordingLog()

    expect(await warmUpApi({ enabled: true, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, { value: false })).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ level: 'warn' })
    expect(lines[0]?.message).toContain('HTTP 500')
  })

  it('reports a request that never reached the server', async () => {
    const { base } = await startServer((_raw, response) => { response.writeHead(200); response.end() })
    const { log, lines } = recordingLog()
    await new Promise<void>((resolve) => { server?.close(() => { resolve() }) })
    server = undefined

    expect(await warmUpApi({ enabled: true, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, { value: false })).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ level: 'warn' })
    expect(lines[0]?.message).toContain('first reply pays the model load')
  })

  it('stays quiet when the profile stops while the warm-up is in flight', async () => {
    const stopped = { value: false }
    const { base } = await startServer((_raw, response) => {
      stopped.value = true
      response.writeHead(200)
      response.end('late answer')
    })
    const { log, lines } = recordingLog()

    expect(await warmUpApi({ enabled: true, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, stopped)).toBe(false)
    expect(lines).toHaveLength(0)
  })

  it('stays quiet when a stopped profile loses the connection mid-answer', async () => {
    const stopped = { value: false }
    const { base } = await startServer((_raw, response) => {
      stopped.value = true
      response.destroy()
    })
    const { log, lines } = recordingLog()

    expect(await warmUpApi({ enabled: true, apiUrl: base, voice, requestTimeoutMs: 5000 }, log, stopped)).toBe(false)
    expect(lines).toHaveLength(0)
  })
})
