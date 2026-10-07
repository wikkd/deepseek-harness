import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectLang, ffmpegArgs, indexttsTts, resolveEngine, resolveIndexPython, validateIndexttsFiles } from '../src/indextts.ts'
import { buildLaunchArgs, createIndexttsSidecar, isServing,
  type IndexttsSidecarSettings } from '../src/indextts-sidecar.ts'

describe('engine dispatch', () => {
  const both = { indexttsUrl: 'http://127.0.0.1:9881', indexRefAudioPath: 'C:/refs/madoka.wav' }
  const gptsovitsOnly = { indexttsUrl: '', indexRefAudioPath: '' }

  it('routes Chinese to IndexTTS under auto and keeps ja/en on GPT-SoVITS', () => {
    expect(resolveEngine('auto', 'zh', both)).toBe('indextts')
    expect(resolveEngine('auto', 'ja', both)).toBe('gptsovits')
    expect(resolveEngine('auto', 'en', both)).toBe('gptsovits')
    expect(resolveEngine('auto', 'ko', both)).toBe('gptsovits')
  })

  it('stays on GPT-SoVITS whenever IndexTTS is not fully available', () => {
    expect(resolveEngine('auto', 'zh', gptsovitsOnly)).toBe('gptsovits')
    expect(resolveEngine('auto', 'zh', { indexttsUrl: 'http://127.0.0.1:9881', indexRefAudioPath: '' })).toBe('gptsovits')
  })

  it('forces the named engine and fails loudly when a forced IndexTTS cannot run', () => {
    expect(resolveEngine('gptsovits', 'zh', both)).toBe('gptsovits')
    expect(resolveEngine('indextts', 'ja', both)).toBe('indextts')
    expect(() => resolveEngine('indextts', 'zh', gptsovitsOnly)).toThrow(/not configured/u)
    expect(() => resolveEngine('indextts', 'zh', { indexttsUrl: 'http://127.0.0.1:9881', indexRefAudioPath: '' }))
      .toThrow(/indexRefAudioPath/u)
  })
})

describe('language detection', () => {
  it('maps scripts to GPT-SoVITS language tags', () => {
    expect(detectLang('こんにちは、圆さん。')).toBe('ja')
    expect(detectLang('안녕하세요')).toBe('ko')
    expect(detectLang('你好，我是小圆。')).toBe('zh')
    expect(detectLang('Hello there')).toBe('en')
    // Kana anywhere wins: a Japanese sentence quoting han stays ja.
    expect(detectLang('確かに色々あったんだけどさ')).toBe('ja')
  })
})

describe('ffmpeg arguments', () => {
  it('appends the loudnorm filter only when asked', () => {
    expect(ffmpegArgs(false)).toEqual(
      ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'])
    expect(ffmpegArgs(true)).toContain('-af')
    expect(ffmpegArgs(true)).toContain('loudnorm=I=-16:TP=-1.5:LRA=11')
  })
})

describe('IndexTTS deployment validation', () => {
  let dir = ''
  let script = ''
  let python = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-indextts-'))
    await mkdir(join(dir, 'indextts'), { recursive: true })
    await mkdir(join(dir, 'checkpoints'), { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'indextts', 'infer_v2_5.py'), '# stub\n')
    await writeFile(join(dir, 'checkpoints', 'config.yaml'), '# stub\n')
    script = join(dir, 'scripts', 'indextts_server.py')
    await writeFile(script, '# stub\n')
    python = process.execPath
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves the checkout venv interpreter and accepts an explicit absolute one', () => {
    expect(resolveIndexPython(dir, python)).toBe(python)
    // The relative/empty path falls through to the checkout venv, which the stub lacks.
    expect(() => resolveIndexPython(dir, '')).toThrow(/indexttsPython/u)
  })

  it('accepts a complete deployment and names the missing piece otherwise', () => {
    validateIndexttsFiles({ indexttsDir: dir, serverScript: script, python })
    expect(() => { validateIndexttsFiles({ indexttsDir: join(dir, 'other'), serverScript: script, python }) })
      .toThrow(/infer_v2_5\.py/u)
    expect(() => { validateIndexttsFiles({ indexttsDir: dir, serverScript: join(dir, 'nope.py'), python }) })
      .toThrow(/indexttsServerScript/u)
  })
})

describe('indextts synthesis client', () => {
  it('posts the service protocol and returns the wav bytes', async () => {
    const wav = Buffer.alloc(64, 1)
    let received = ''
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        received = body
        res.writeHead(200, { 'content-type': 'audio/wav' })
        res.end(wav)
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
    const port = (server.address() as { port: number }).port
    try {
      const out = await indexttsTts(`http://127.0.0.1:${String(port)}`, '你好', 'C:/refs/madoka.wav', 'zh', 5000)
      expect(out.equals(wav)).toBe(true)
      expect(JSON.parse(received)).toEqual({ text: '你好', ref_wav: 'C:/refs/madoka.wav', lang: 'ZH' })
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('surfaces service errors with the body detail', async () => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'boom' }))
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
    const port = (server.address() as { port: number }).port
    try {
      await expect(indexttsTts(`http://127.0.0.1:${String(port)}`, '你好', 'C:/refs/madoka.wav', 'zh', 5000))
        .rejects.toThrow(/HTTP 500.*boom/u)
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })
})

describe('indextts sidecar', () => {
  /** A logger stand-in that keeps the sidecar's output observable. */
  const lines: string[] = []
  const logger = {
    info: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
    warn: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
    error: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
  }

  let dir = ''
  let port = 0
  let url = ''
  let settings: IndexttsSidecarSettings

  /**
   * Bind an HTTP server on an ephemeral loopback port, close it, and report the
   * freed port so a spawned stub can claim it with a known-numbered listener.
   * @returns a free loopback port.
   */
  async function freePort(): Promise<number> {
    const server: Server = createServer()
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = server.address()
    const freed = typeof address === 'object' && address !== null ? address.port : 0
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    return freed
  }

  /**
   * Spawn a stub "IndexTTS server": a Node process that serves HTTP 200 on the
   * given port after an optional delay, exercising the real spawn/probe path.
   * @param servePort - the port to serve on.
   * @param serveAfterMs - how long to wait before opening the listener.
   * @returns the child process.
   */
  function spawnStub(servePort: number, serveAfterMs = 0): ReturnType<typeof spawn> {
    const script = `setTimeout(() => {
      require('http').createServer((q, s) => s.end('ok')).listen(${String(servePort)}, '127.0.0.1', () => console.log('up'))
    }, ${String(serveAfterMs)})`
    return spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-indextts-sidecar-'))
    port = await freePort()
    url = `http://127.0.0.1:${String(port)}`
    settings = {
      indexttsDir: dir, serverScript: join(dir, 'indextts_server.py'), python: process.execPath,
      modelDir: join(dir, 'checkpoints'), host: '127.0.0.1', port, url, startupTimeoutMs: 10_000,
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('builds the VoiceCut-proven launch line', () => {
    expect(buildLaunchArgs(settings)).toEqual([
      join(dir, 'indextts_server.py'), '--model_dir', join(dir, 'checkpoints'),
      '--host', '127.0.0.1', '--port', String(port),
    ])
  })

  it('spawns the server, reports readiness through the probe, and kills it on dispose', async () => {
    const sidecar = createIndexttsSidecar(logger, settings, () => spawnStub(port, 300))
    await sidecar.ensureRunning()
    expect(await isServing(url)).toBe(true)
    sidecar.dispose()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(await isServing(url)).toBe(false)
    await expect(sidecar.ensureRunning()).rejects.toThrow(/disposed/u)
  })

  it('reuses an already-serving origin without spawning anything', async () => {
    const server: Server = createServer((_request, response) => { response.end('ok') })
    await new Promise<void>((resolve) => { server.listen(port, '127.0.0.1', () => { resolve() }) })
    try {
      let spawned = 0
      const sidecar = createIndexttsSidecar(logger, settings, () => {
        spawned += 1
        return spawnStub(port)
      })
      await sidecar.ensureRunning()
      expect(spawned).toBe(0)
      sidecar.dispose()
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('times out loudly when the spawned child never serves', async () => {
    const sidecar = createIndexttsSidecar(logger, { ...settings, startupTimeoutMs: 900 },
      () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']))
    await expect(sidecar.ensureRunning()).rejects.toThrow(/did not become ready/u)
    sidecar.dispose()
  }, 10_000)

  it('respawns after the child died between requests', async () => {
    let attempt = 0
    const sidecar = createIndexttsSidecar(logger, settings, () => {
      attempt += 1
      // First request: the child dies immediately; second request: it serves.
      return attempt === 1
        ? spawn(process.execPath, ['-e', 'process.exit(0)'])
        : spawnStub(port, 200)
    })
    await expect(sidecar.ensureRunning()).rejects.toThrow(/exited during startup/u)
    await sidecar.ensureRunning()
    expect(await isServing(url)).toBe(true)
    sidecar.dispose()
  }, 15_000)
})
