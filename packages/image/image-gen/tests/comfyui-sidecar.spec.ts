import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLaunchArgs,
  createComfyuiSidecar,
  isServing,
  parseLoopbackOrigin,
  resolvePythonExecutable,
} from '../src/comfyui-sidecar.ts'
import type { SidecarSettings } from '../src/comfyui-sidecar.ts'

/** A logger stand-in that keeps the sidecar's output observable. */
const lines: string[] = []
const logger = {
  info: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
  warn: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
  error: (format: string, ...values: unknown[]): void => { lines.push(`${format} ${values.join(' ')}`) },
}

/**
 * Bind an HTTP server on an ephemeral loopback port, close it, and report the
 * freed port so a spawned stub can claim it with a known-numbered listener.
 * @returns a free loopback port.
 */
async function freePort(): Promise<number> {
  const server: Server = createServer()
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => { server.close(() => resolve()) })
  return port
}

/**
 * Spawn a stub "ComfyUI": a Node process that serves HTTP 200 on the given
 * port after an optional delay, exercising the real spawn/probe path.
 * @param port - the port to serve on.
 * @param serveAfterMs - how long to wait before opening the listener.
 * @returns the child process.
 */
function spawnStub(port: number, serveAfterMs = 0): ReturnType<typeof spawn> {
  const script = `setTimeout(() => {
    require('http').createServer((q, s) => s.end('ok')).listen(${String(port)}, '127.0.0.1', () => console.log('up'))
  }, ${String(serveAfterMs)})`
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
}

describe('comfyui sidecar', () => {
  let dir = ''
  let port = 0
  let origin = ''
  let settings: SidecarSettings

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-comfyui-sidecar-'))
    await writeFile(join(dir, 'main.py'), '# stub\n')
    port = await freePort()
    origin = `http://127.0.0.1:${String(port)}`
    settings = {
      comfyuiDir: dir, pythonPath: '', origin, host: '127.0.0.1', port,
      startupTimeoutMs: 10_000, extraArgs: '',
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('parses loopback http origins and rejects everything a child cannot serve', () => {
    expect(parseLoopbackOrigin('http://127.0.0.1:8188')).toEqual({ host: '127.0.0.1', port: 8188 })
    expect(parseLoopbackOrigin('http://localhost:8188')).toEqual({ host: 'localhost', port: 8188 })
    expect(parseLoopbackOrigin('http://127.0.0.1')).toEqual({ host: '127.0.0.1', port: 80 })
    expect(parseLoopbackOrigin('https://127.0.0.1:8188')).toBeUndefined()
    expect(parseLoopbackOrigin('http://192.168.1.4:8188')).toBeUndefined()
    expect(parseLoopbackOrigin('not a url')).toBeUndefined()
  })

  it('builds the launch line with listen, port, and verbatim extras', () => {
    expect(buildLaunchArgs({ ...settings, extraArgs: '' })).toEqual(['main.py', '--listen', '127.0.0.1', '--port', String(port)])
    expect(buildLaunchArgs({ ...settings, extraArgs: ' --cpu  --max-upload-size 100 ' }))
      .toEqual(['main.py', '--listen', '127.0.0.1', '--port', String(port), '--cpu', '--max-upload-size', '100'])
  })

  it('resolves the configured interpreter and fails loudly when nothing exists', async () => {
    expect(resolvePythonExecutable({ ...settings, pythonPath: process.execPath })).toBe(process.execPath)
    expect(() => resolvePythonExecutable({ ...settings, pythonPath: join(dir, 'missing-python') }))
      .toThrow(/fix comfyuiPythonPath/u)
    expect(() => resolvePythonExecutable(settings)).toThrow(/comfyuiPythonPath/u)
  })

  it('spawns the server, reports readiness through the probe, and kills it on dispose', async () => {
    const sidecar = createComfyuiSidecar(logger, { ...settings, pythonPath: process.execPath }, () => spawnStub(port, 300))
    await sidecar.ensureRunning()
    expect(await isServing(origin)).toBe(true)
    sidecar.dispose()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(await isServing(origin)).toBe(false)
    await expect(sidecar.ensureRunning()).rejects.toThrow(/disposed/u)
  })

  it('reuses an already-serving origin without spawning anything', async () => {
    const server: Server = createServer((_request, response) => { response.end('ok') })
    await new Promise<void>(resolve => { server.listen(port, '127.0.0.1', resolve) })
    try {
      let spawned = 0
      const sidecar = createComfyuiSidecar(logger, settings, () => {
        spawned += 1
        return spawnStub(port)
      })
      await sidecar.ensureRunning()
      expect(spawned).toBe(0)
      sidecar.dispose()
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()) })
    }
  })

  it('times out loudly when the spawned child never serves', async () => {
    const sidecar = createComfyuiSidecar(logger, { ...settings, pythonPath: process.execPath, startupTimeoutMs: 900 }, () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']))
    await expect(sidecar.ensureRunning()).rejects.toThrow(/did not become ready/u)
    sidecar.dispose()
  }, 10_000)

  it('respawns after the child died between renders', async () => {
    let attempt = 0
    const sidecar = createComfyuiSidecar(logger, { ...settings, pythonPath: process.execPath }, () => {
      attempt += 1
      // First render: the child dies immediately; second render: it serves.
      return attempt === 1
        ? spawn(process.execPath, ['-e', 'process.exit(0)'])
        : spawnStub(port, 200)
    })
    await expect(sidecar.ensureRunning()).rejects.toThrow(/exited during startup/u)
    await sidecar.ensureRunning()
    expect(await isServing(origin)).toBe(true)
    sidecar.dispose()
  }, 15_000)
})
