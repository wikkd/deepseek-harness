import { describe, expect, it } from 'vitest'
import { decideTier, probeComfyuiStats } from '../src/tier-routing.ts'
import type { RoutingInputs } from '../src/tier-routing.ts'

/** A comfortable host: fine files present, plenty of spare RAM/VRAM. */
function baseInputs(overrides: Partial<RoutingInputs> = {}): RoutingInputs {
  return {
    quality: 'auto',
    freeRamGiB: 16,
    freeVramGiB: 12,
    fineAvailable: true,
    backend: 'comfyui',
    ...overrides,
  }
}

describe('decideTier', () => {
  it('routes fine when the model judges the task demanding', () => {
    expect(decideTier(baseInputs({ quality: 'fine' }))).toEqual({ tier: 'fine', reason: 'the model judged the task demanding' })
  })

  it('routes fast when the model judges the task simple, even on an idle host', () => {
    expect(decideTier(baseInputs({ quality: 'fast' }))).toEqual({ tier: 'fast', reason: 'the model judged the task simple' })
  })

  it('resolves an undeclared quality to fine on an idle host', () => {
    expect(decideTier(baseInputs())).toEqual({ tier: 'fine', reason: 'quality undeclared and the host has headroom' })
  })

  it('a resource-tight host overrides every preference — low RAM routes fast', () => {
    const decision = decideTier(baseInputs({ quality: 'fine', freeRamGiB: 2 }))
    expect(decision.tier).toBe('fast')
    expect(decision.reason).toMatch(/RAM/)
  })

  it('a resource-tight host overrides every preference — low VRAM routes fast', () => {
    const decision = decideTier(baseInputs({ quality: 'fine', freeVramGiB: 2 }))
    expect(decision.tier).toBe('fast')
    expect(decision.reason).toMatch(/VRAM/)
  })

  it('missing fine-tier files force the fast tier regardless of the ask', () => {
    expect(decideTier(baseInputs({ quality: 'fine', fineAvailable: false }))).toEqual({
      tier: 'fast',
      reason: 'the fine-tier model files are not configured or missing',
    })
  })

  it('a failed capacity probe still routes an undeclared ask to fast (probe constrains nothing, headroom unknown)', () => {
    const decision = decideTier(baseInputs({ freeRamGiB: undefined, freeVramGiB: undefined, quality: 'auto' }))
    expect(decision.tier).toBe('fine')
  })

  it('the hosted API backend never routes to the fine tier', () => {
    expect(decideTier(baseInputs({ backend: 'openai-images', quality: 'fine' }))).toEqual({
      tier: 'fast',
      reason: 'the configured backend is the hosted images API',
    })
  })
})

describe('probeComfyuiStats', () => {
  it('reads system-level free RAM and device free VRAM in GiB from /system_stats', async () => {
    const origin = await serveOnce({
      system: { comfyui_version: '0.3', ram_total: 32 * 1024 ** 3, ram_free: 8 * 1024 ** 3 },
      devices: [{ name: 'gpu', type: 'cuda', vram_total: 17_179_869_184, vram_free: 4 * 1024 ** 3 }],
    })
    expect(await probeComfyuiStats(origin)).toEqual({ freeRamGiB: 8, freeVramGiB: 4 })
  })

  it('answers empty fields when the endpoint errors or the shape is foreign', async () => {
    expect(await probeComfyuiStats('http://127.0.0.1:9')).toEqual({})
    const dead = await probeComfyuiStats('http://127.0.0.1:1')
    expect(dead).toEqual({})
  })
})

/** One-shot HTTP server handing back a canned JSON body, closed after one request. */
async function serveOnce(body: unknown): Promise<string> {
  const { createServer } = await import('node:http')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
    setImmediate(() => { server.close() })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return `http://127.0.0.1:${String(port)}`
}
