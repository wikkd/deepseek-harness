import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildFastGraph, buildFineGraph, validateFineTierFiles } from '../src/comfy-graph.ts'

describe('comfy graph builders', () => {
  it('builds the fast graph on the checkpoint loader with tuned sampler values', () => {
    const graph = buildFastGraph('sd_xl_turbo.safetensors', 'a cat', '', 512, 512, 2, 1, 42)
    expect(graph['1']).toEqual({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_turbo.safetensors' } })
    expect(graph['5'].inputs).toMatchObject({ seed: 42, steps: 2, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 })
    expect(graph['2'].inputs).toMatchObject({ text: 'a cat', clip: ['1', 1] })
    expect(graph['3'].inputs).toMatchObject({ text: '', clip: ['1', 1] })
    expect(graph['4'].inputs).toEqual({ width: 512, height: 512, batch_size: 1 })
    expect(graph['7'].class_type).toBe('SaveImage')
  })

  it('builds the fine graph on the GGUF loader trio with the clip type', () => {
    const files = { unet: 'qwen-image-2.1-Q8_0.gguf', clip: 'qwen3vl_8b_int8_convrot.safetensors', clipType: 'qwen_image', vae: 'qwen_image_2.1_vae_bf16.safetensors' }
    const graph = buildFineGraph(files, '一只猫', '模糊', 1024, 576, 25, 1, 7)
    expect(graph['1']).toEqual({ class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'qwen-image-2.1-Q8_0.gguf' } })
    expect(graph['2']).toEqual({ class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image' } })
    expect(graph['3']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } })
    expect(graph['4'].inputs).toMatchObject({ text: '一只猫', clip: ['2', 0] })
    expect(graph['4n'].inputs).toMatchObject({ text: '模糊', clip: ['2', 0] })
    expect(graph['6'].inputs).toMatchObject({ seed: 7, steps: 25, cfg: 1, model: ['1', 0], positive: ['4', 0], negative: ['4n', 0] })
    expect(graph['8'].class_type).toBe('SaveImage')
  })

  it('keeps both graphs ending in the same save contract', () => {
    const fast = buildFastGraph('a.safetensors', 'x', '', 64, 64, 1, 1, 1)
    const files = { unet: 'u.gguf', clip: 'c.safetensors', clipType: 'qwen_image', vae: 'v.safetensors' }
    const fine = buildFineGraph(files, 'x', '', 64, 64, 1, 1, 1)
    expect(fast['7']).toEqual({ class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-image-gen', images: ['6', 0] } })
    expect(fine['8']).toEqual({ class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-image-gen', images: ['7', 0] } })
  })
})

describe('validateFineTierFiles', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-fine-tier-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts when every model file sits in its models subdirectory', async () => {
    await mkdir(join(dir, 'models', 'diffusion_models'), { recursive: true })
    await mkdir(join(dir, 'models', 'text_encoders'), { recursive: true })
    await mkdir(join(dir, 'models', 'vae'), { recursive: true })
    await writeFile(join(dir, 'models', 'diffusion_models', 'u.gguf'), 'x')
    await writeFile(join(dir, 'models', 'text_encoders', 'c.safetensors'), 'x')
    await writeFile(join(dir, 'models', 'vae', 'v.safetensors'), 'x')
    expect(() => { validateFineTierFiles(dir, { unet: 'u.gguf', clip: 'c.safetensors', clipType: 'qwen_image', vae: 'v.safetensors' }) }).not.toThrow()
  })

  it('throws naming the first missing file and its directory', async () => {
    await mkdir(join(dir, 'models', 'diffusion_models'), { recursive: true })
    expect(() => { validateFineTierFiles(dir, { unet: 'missing.gguf', clip: 'c.safetensors', clipType: 'qwen_image', vae: 'v.safetensors' }) })
      .toThrow(/missing\.gguf.*models\/diffusion_models/)
  })

  it('throws on an empty file name before touching the filesystem', () => {
    expect(() => { validateFineTierFiles(dir, { unet: '  ', clip: 'c.safetensors', clipType: 'qwen_image', vae: 'v.safetensors' }) })
      .toThrow(/incomplete/)
  })
})
