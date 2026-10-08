/**
 * Model-facing `generate_image` tool over an OpenAI-compatible text-to-image
 * API (default: SiliconFlow) or a local ComfyUI server. One call produces one
 * picture; the bytes commit to the durable attachment store and the result
 * pairs a text envelope with the image content block, so native transcripts,
 * PTC dispatches, and replayed web cards all see the same picture without
 * provider-specific plumbing. On ComfyUI the tool routes between a fast
 * checkpoint tier and a fine GGUF tier by the model's difficulty judgment and
 * the host's probed spare capacity.
 * @module @deepseek-ai/dsh-image-gen
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createComfyuiSidecar, parseLoopbackOrigin, validateSidecarFiles } from './comfyui-sidecar.ts'
import type { ComfyuiSidecar } from './comfyui-sidecar.ts'
import { buildFastGraph, buildFineGraph, validateFineTierFiles } from './comfy-graph.ts'
import type { ComfyGraph, FineTierFiles } from './comfy-graph.ts'
import { decideTier, probeComfyuiStats } from './tier-routing.ts'
import type { RoutingDecision } from './tier-routing.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'image-gen'

/** The tool registry this plugin contributes to; the attachment store is required at apply time. */
export const inject = ['tools'] as const

/** Plugin config: provider endpoint, model, credentials source, and request bounds. */
export interface Config {
  /**
   * Generation backend: `comfyui` drives a local ComfyUI server (no key),
   * `openai-images` calls an OpenAI-compatible images API. Defaults to
   * `comfyui` when `comfyuiUrl` answers, else `openai-images`.
   */
  backend?: 'comfyui' | 'openai-images'
  /** Local ComfyUI server origin (e.g. http://127.0.0.1:8188). */
  comfyuiUrl?: string
  /** Fast-tier ComfyUI checkpoint name under models/checkpoints. */
  comfyuiCheckpoint?: string
  /** Fast-tier ComfyUI sampler steps; turbo/distilled checkpoints need 1-4. */
  comfyuiSteps?: number
  /** Fast-tier ComfyUI CFG guidance; turbo checkpoints want ~1. */
  comfyuiCfg?: number
  /**
   * Absolute ComfyUI checkout directory (`main.py` at its root). When set and
   * the backend is `comfyui`, the plugin owns the server's lifecycle: it
   * spawns `main.py` when the origin is not serving, respawns after a crash
   * on the next render, and kills the child when the profile stops. Empty
   * leaves server management to the operator.
   */
  comfyuiDir?: string
  /** Python interpreter that runs ComfyUI; empty uses `<comfyuiDir>/python_embeded`. */
  comfyuiPythonPath?: string
  /** Deadline for one managed-startup poll sequence. */
  comfyuiStartupTimeoutMs?: number
  /** Extra ComfyUI CLI arguments appended verbatim (whitespace-split). */
  comfyuiExtraArgs?: string
  /**
   * Fine-tier GGUF diffusion model name under ComfyUI `models/diffusion_models`.
   * Set all three comfyuiFine* file fields together to enable tiered routing;
   * leave all empty to always render on the fast checkpoint.
   */
  comfyuiFineUnet?: string
  /** Fine-tier text-encoder name under ComfyUI `models/text_encoders`. */
  comfyuiFineClip?: string
  /** Fine-tier CLIPLoader `type` widget value (e.g. `qwen_image`). */
  comfyuiFineClipType?: string
  /** Fine-tier VAE name under ComfyUI `models/vae`. */
  comfyuiFineVae?: string
  /** Fine-tier sampler steps; quality models typically want 20-30. */
  comfyuiFineSteps?: number
  /** Fine-tier CFG guidance. */
  comfyuiFineCfg?: number
  /** OpenAI-compatible images API origin; `/images/generations` is appended. */
  baseUrl?: string
  /** Text-to-image model id the provider routes (e.g. `black-forest-labs/FLUX.1-schnell`). */
  model?: string
  /** Environment variable holding the provider API key; the value never enters config or logs. */
  apiKeyEnv?: string
  /** Default image size as `宽x高` pixels, e.g. `1024x1024`. */
  size?: string
  /** Deadline for the provider request plus the picture download; fine-tier renders count against it. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  backend: z.union(['comfyui', 'openai-images']).description('Generation backend; comfyui drives the local server without a key.').default('comfyui'),
  comfyuiUrl: z.string().description('Local ComfyUI server origin.').default('http://127.0.0.1:8188'),
  comfyuiCheckpoint: z.string().description('Fast-tier ComfyUI checkpoint name under models/checkpoints.').default('sd_xl_turbo_1.0_fp16.safetensors'),
  comfyuiSteps: z.number().description('Fast-tier ComfyUI sampler steps; turbo checkpoints need 1-4.').default(2),
  comfyuiCfg: z.number().description('Fast-tier ComfyUI CFG guidance; turbo checkpoints want ~1.').default(1),
  comfyuiDir: z.string().description('Absolute ComfyUI checkout directory (main.py at its root); set it to let the plugin spawn and supervise the server.').default(''),
  comfyuiPythonPath: z.string().description('Python interpreter for ComfyUI; empty uses <comfyuiDir>/python_embeded.').default(''),
  comfyuiStartupTimeoutMs: z.number().description('Deadline for one managed ComfyUI startup.').default(120_000),
  comfyuiExtraArgs: z.string().description('Extra ComfyUI CLI arguments appended verbatim.').default(''),
  comfyuiFineUnet: z.string().description('Fine-tier GGUF diffusion model under ComfyUI models/diffusion_models; set with comfyuiFineClip and comfyuiFineVae to enable tiered routing.').default(''),
  comfyuiFineClip: z.string().description('Fine-tier text encoder under ComfyUI models/text_encoders.').default(''),
  comfyuiFineClipType: z.string().description('Fine-tier CLIPLoader type widget value.').default('qwen_image'),
  comfyuiFineVae: z.string().description('Fine-tier VAE under ComfyUI models/vae.').default(''),
  comfyuiFineSteps: z.number().description('Fine-tier sampler steps.').default(25),
  comfyuiFineCfg: z.number().description('Fine-tier CFG guidance.').default(1),
  baseUrl: z.string().description('OpenAI-compatible images API origin; /images/generations is appended.').default('https://api.siliconflow.cn/v1'),
  model: z.string().description('Text-to-image model id the provider routes.').default('black-forest-labs/FLUX.1-schnell'),
  apiKeyEnv: z.string().description('Environment variable holding the provider API key.').default('IMAGE_GEN_API_KEY'),
  size: z.string().description('Default image size as WIDTHxHEIGHT pixels.').default('1024x1024'),
  timeoutMs: z.number().description('Deadline for one generation request plus picture download.').default(120_000),
})

/** Config after schemastery filled every default. */
interface ResolvedConfig {
  backend: 'comfyui' | 'openai-images'
  comfyuiUrl: string
  comfyuiCheckpoint: string
  comfyuiSteps: number
  comfyuiCfg: number
  comfyuiDir: string
  comfyuiPythonPath: string
  comfyuiStartupTimeoutMs: number
  comfyuiExtraArgs: string
  comfyuiFineUnet: string
  comfyuiFineClip: string
  comfyuiFineClipType: string
  comfyuiFineVae: string
  comfyuiFineSteps: number
  comfyuiFineCfg: number
  baseUrl: string
  model: string
  apiKeyEnv: string
  size: string
  timeoutMs: number
}

const SIZE_PATTERN = /^\d{2,5}x\d{2,5}$/

/**
 * Parse a WIDTHxHEIGHT size string.
 * @param size - validated size string.
 * @returns the two dimensions.
 */
function parseSize(size: string): { width: number; height: number } {
  const [rawWidth = '', rawHeight = ''] = size.split('x')
  return { width: Number(rawWidth), height: Number(rawHeight) }
}

/**
 * Submit one API-format graph to ComfyUI, poll until it settles, then
 * download the finished file from `/view`.
 * @param origin - ComfyUI server origin without a trailing slash.
 * @param graph - the API-format prompt graph to run.
 * @param timeoutMs - deadline for the whole queue-poll-download sequence.
 * @param signal - cooperative cancellation.
 * @returns the encoded picture bytes.
 */
async function runComfyGraph(origin: string, graph: ComfyGraph, timeoutMs: number,
  signal: AbortSignal): Promise<Uint8Array> {
  const queued = await fetch(`${origin}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'dsh-image-gen' }), signal,
  })
  if (!queued.ok) throw new Error(`ComfyUI rejected the prompt (HTTP ${queued.status}): ${(await queued.text()).slice(0, 200)}`)
  const { prompt_id: promptId } = await queued.json() as { prompt_id?: string }
  if (promptId === undefined) throw new Error('ComfyUI answered without a prompt id')

  // Poll /history/{id}; a settled entry names its output file(s) under outputs.
  const deadline = Date.now() + timeoutMs
  let filename: string | undefined
  let subfolder = ''
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('image generation cancelled')
    await new Promise(resolve => setTimeout(resolve, 500))
    const state = await fetch(`${origin}/history/${promptId}`, { signal })
    if (!state.ok) continue
    const history = await state.json() as Record<string, {
      status?: { completed?: boolean; status_str?: string }
      outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>
    }>
    const entry = history[promptId]
    if (entry?.status?.status_str === 'error') throw new Error('ComfyUI reported the generation failed; check its console for the node error')
    const saved = Object.values(entry?.outputs ?? {}).flatMap(node => node.images ?? []).find(image => image.type === 'output')
    if (saved !== undefined) {
      filename = saved.filename
      subfolder = saved.subfolder ?? ''
      break
    }
  }
  if (filename === undefined) throw new Error(`ComfyUI did not finish within ${String(timeoutMs)} ms`)
  const params = new URLSearchParams({ filename, type: 'output' })
  if (subfolder !== '') params.set('subfolder', subfolder)
  const view = await fetch(`${origin}/view?${params.toString()}`, { signal })
  if (!view.ok) throw new Error(`the picture download from ComfyUI answered HTTP ${view.status}`)
  return new Uint8Array(await view.arrayBuffer())
}

/** File signatures of the media types the attachment store's image limits already accept. */
const SIGNATURES: readonly { mediaType: ImageMediaType; parts: readonly { offset: number; bytes: readonly number[] }[] }[] = [
  { mediaType: 'image/png', parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { mediaType: 'image/jpeg', parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mediaType: 'image/gif', parts: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  {
    mediaType: 'image/webp',
    parts: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
  },
]

/**
 * Identify the encoded image format from its file signature.
 * @param data - downloaded picture bytes.
 * @returns the detected media type, or undefined when the bytes claim no supported format.
 */
function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  return SIGNATURES.find(({ parts }) => parts.every(({ offset, bytes }) =>
    bytes.every((byte, index) => data[offset + index] === byte),
  ))?.mediaType
}

/**
 * The structured outcome declared by the `generate_image` output schema.
 * The image metadata mirrors the durable attachment reference the content
 * block carries, so both views agree without cross-deriving.
 */
export interface ImageGenValue {
  prompt: string
  /** The tier that rendered the picture; `fast` on backends without routing. */
  tier: 'fast' | 'fine'
  /** The model identifier that rendered the picture. */
  model: string
  /** Why the router picked the tier; stable phrasing for the envelope. */
  routing: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

/**
 * Generate one picture through an OpenAI-compatible images API.
 * @param resolved - resolved plugin config.
 * @param prompt - the user's text prompt.
 * @param size - validated WIDTHxHEIGHT string.
 * @param signal - cooperative cancellation.
 * @returns the encoded picture bytes.
 */
async function generateViaOpenAIImages(resolved: ResolvedConfig, prompt: string,
  size: string, signal: AbortSignal): Promise<Uint8Array> {
  const apiKey = process.env[resolved.apiKeyEnv]
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error(`image generation is not configured: set the ${resolved.apiKeyEnv} environment variable to the provider API key and restart`)
  }
  const origin = resolved.baseUrl.replace(/\/+$/u, '')
  const response = await fetch(`${origin}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: resolved.model, prompt, size, image_size: size }),
    signal,
  })
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300)
    throw new Error(`image generation failed: provider answered HTTP ${response.status}: ${body}`)
  }
  const payload: unknown = await response.json()
  const picture = firstPicture(payload)
  if (picture === undefined) {
    throw new Error(`image generation failed: the provider response names no picture: ${JSON.stringify(payload).slice(0, 300)}`)
  }
  if (picture.b64 !== undefined) return new Uint8Array(Buffer.from(picture.b64, 'base64'))
  const download = await fetch(picture.url ?? '', { signal })
  if (!download.ok) throw new Error(`image generation failed: the picture download answered HTTP ${download.status}`)
  return new Uint8Array(await download.arrayBuffer())
}

/**
 * Re-brand the structured outcome into the durable attachment reference an
 * image content block carries.
 * @param image - the image metadata from the output schema.
 * @returns the branded attachment reference.
 */
function imageRefFromValue(image: ImageGenValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Format the model-facing envelope beside the image block.
 * @param value - the generation outcome.
 * @returns the envelope text; the picture itself rides the adjacent image block.
 */
function formatImageGenOutput(value: ImageGenValue): string {
  const { image } = value
  return `<prompt>${value.prompt}</prompt>
<type>image</type>
<model>${value.model}</model>
<tier>${value.tier}</tier>
<routing>${value.routing}</routing>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes
</content>`
}

/**
 * Shape the provider response the way every OpenAI-compatible images endpoint
 * answers: entries carrying a picture URL or inline base64 under `data`, with
 * SiliconFlow's `images` array accepted beside it.
 * @param payload - the parsed JSON body of the generation response.
 * @returns the first usable entry, or undefined when the body names no picture.
 */
function firstPicture(payload: unknown): { url?: string; b64?: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const lists = [record.data, record.images]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue
      const { url, b64_json } = entry as Record<string, unknown>
      if (typeof url === 'string' && url.startsWith('http')) return { url }
      if (typeof b64_json === 'string' && b64_json !== '') return { b64: b64_json }
    }
  }
  return undefined
}

/**
 * Decide the rendering tier for one ComfyUI picture: probe the server's spare
 * capacity (a failed probe constrains nothing) and run it through the router
 * with the caller's difficulty judgment.
 * @param origin - ComfyUI server origin without a trailing slash.
 * @param quality - the model's difficulty judgment from the tool arguments.
 * @param fineAvailable - whether the fine-tier model files are configured.
 * @returns the routing decision.
 */
async function routeTier(origin: string, quality: 'fast' | 'fine' | 'auto',
  fineAvailable: boolean): Promise<RoutingDecision> {
  const stats = await probeComfyuiStats(origin)
  return decideTier({
    quality,
    freeRamGiB: stats.freeRamGiB,
    freeVramGiB: stats.freeVramGiB,
    fineAvailable,
    backend: 'comfyui',
  })
}

/**
 * Register the `generate_image` tool inside a scope that has the durable
 * attachment store mounted; images must outlive the session to replay, so a
 * missing store refuses activation instead of failing at generation time.
 * @param ctx - the registration scope.
 * @param resolved - the plugin config with every default applied.
 * @param sidecar - the managed ComfyUI server, or undefined when server
 * management is off; a set sidecar is awaited before every local render.
 * @param fineFiles - the fine-tier model files, or undefined when tiered
 * routing is off (all comfyuiFine* file fields empty).
 */
function registerTool(ctx: Context, resolved: ResolvedConfig, sidecar: ComfyuiSidecar | undefined,
  fineFiles: FineTierFiles | undefined): void {
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one image from a text description with a text-to-image model. '
      + 'Use it when the user asks to draw, render, or illustrate something; the picture is shown to the user as a card. '
      + 'Write the prompt as a concrete description of subject, style, and composition; the provider handles any language. '
      + 'Set quality to "fine" for demanding pictures — detailed scenes, complex compositions, readable text inside the image, '
      + 'or Chinese-heavy prompts — and to "fast" for quick sketches, drafts, and icons. '
      + 'Omit quality when the difficulty is unclear; the host decides from its spare capacity. '
      + 'The result is delivered as an automatic picture card — never paste the returned path into your reply text.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the picture should show: subject, style, and composition.' },
      quality: {
        type: 'string',
        enum: ['fast', 'fine'],
        description: 'Difficulty judgment: "fine" renders on the high-quality local model (slower), "fast" on the quick draft model. Omit to let the host decide.',
      },
      size: { type: 'string', description: `Picture size as WIDTHxHEIGHT pixels. Defaults to ${resolved.size}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', required: true },
          tier: { type: 'string', enum: ['fast', 'fine'], required: true },
          model: { type: 'string', required: true },
          routing: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
              hostPath: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value): ContentBlock[] => [
        { type: 'text', text: formatImageGenOutput(value) },
        { type: 'image', attachment: imageRefFromValue(value.image) },
      ],
    },
    // Provider calls are independent; a retry never conflicts with a prior one.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt === '') throw new Error('prompt must not be empty')
      const size = (args.size ?? resolved.size).trim()
      if (!SIZE_PATTERN.test(size)) throw new Error(`size must look like 1024x1024, got "${args.size ?? resolved.size}"`)

      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('no attachment service is mounted; images cannot be stored')

      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(resolved.timeoutMs)])
      let data: Uint8Array
      let tier: 'fast' | 'fine'
      let modelUsed: string
      let routing: string
      if (resolved.backend === 'comfyui') {
        const origin = resolved.comfyuiUrl.replace(/\/+$/u, '')
        try {
          // A configured sidecar makes the server a managed prerequisite:
          // first render waits out the spawn, a crashed server respawns here.
          await sidecar?.ensureRunning()
          const decision = await routeTier(origin, args.quality ?? 'auto', fineFiles !== undefined)
          tier = decision.tier
          routing = decision.reason
          const seed = Math.floor(Math.random() * 1_000_000_000)
          const { width, height } = parseSize(size)
          const graph = tier === 'fine' && fineFiles !== undefined
            ? buildFineGraph(fineFiles, prompt, '', width, height, resolved.comfyuiFineSteps, resolved.comfyuiFineCfg, seed)
            : buildFastGraph(resolved.comfyuiCheckpoint, prompt, '', width, height, resolved.comfyuiSteps, resolved.comfyuiCfg, seed)
          modelUsed = tier === 'fine' && fineFiles !== undefined ? fineFiles.unet : resolved.comfyuiCheckpoint
          data = await runComfyGraph(origin, graph, resolved.timeoutMs, signal)
        } catch (error: unknown) {
          if (signal.aborted) throw error
          const cause = error instanceof Error ? error.message : String(error)
          const hint = sidecar === undefined
            ? '; is ComfyUI running and are the configured model files present under models/?'
            : ' — the managed server log lines above ([comfyui]) say what went wrong'
          throw new Error(`local ComfyUI at ${origin} failed: ${cause}${hint}`, { cause: error instanceof Error ? error : undefined })
        }
      } else {
        const decision = decideTier({ quality: 'auto', freeRamGiB: undefined, freeVramGiB: undefined, fineAvailable: false, backend: 'openai-images' })
        tier = decision.tier
        modelUsed = resolved.model
        routing = decision.reason
        data = await generateViaOpenAIImages(resolved, prompt, size, signal)
      }
      const mediaType = sniffImageMediaType(data) ?? 'image/png'

      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({ data, mediaType, name: 'generated-image.png' })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError)) throw error
        if (error.code === 'IMAGE_TOO_LARGE' || error.code === 'IMAGE_DIMENSION_TOO_LARGE' || error.code === 'IMAGE_TOO_MANY_PIXELS') {
          throw new Error(`the generated image exceeds this deployment's attachment limits (${error.code}); try a smaller size`, { cause: error })
        }
        throw new Error(`the provider returned bytes that do not decode as a supported image (${error.code})`, { cause: error })
      }
      const hostPath = attachments.imageHostPath(ref)

      return {
        prompt,
        tier,
        model: modelUsed,
        routing,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
          // The provider-owned durable object location. The client opens it in
          // the sidebar preview on click; undefined on non-host-file backends.
          ...hostPath === undefined ? {} : { hostPath },
        },
      }
    },
    // Pure display: a generic pending card; the completed picture renders
    // through the client row keyed to this tool name.
    presentCall() {
      return { card: 'generic', title: 'Generate image' }
    },
  }))
}

/**
 * Resolve the fine-tier model file names from config. All three file fields
 * must be set together or all empty; a partial trio is a loud misconfiguration.
 * @param resolved - the plugin config with every default applied.
 * @returns the fine-tier files, or undefined when routing is off.
 */
function resolveFineFiles(resolved: ResolvedConfig): FineTierFiles | undefined {
  const anySet = resolved.comfyuiFineUnet !== '' || resolved.comfyuiFineClip !== '' || resolved.comfyuiFineVae !== ''
  if (!anySet) return undefined
  if (resolved.comfyuiFineUnet === '' || resolved.comfyuiFineClip === '' || resolved.comfyuiFineVae === '') {
    throw new Error('image-gen: tiered routing needs comfyuiFineUnet, comfyuiFineClip, and comfyuiFineVae set together (or all empty)')
  }
  return {
    unet: resolved.comfyuiFineUnet,
    clip: resolved.comfyuiFineClip,
    clipType: resolved.comfyuiFineClipType,
    vae: resolved.comfyuiFineVae,
  }
}

/**
 * Register the image-generation tool. Registration waits for the attachment
 * store so the tool exists exactly while durable image storage is available.
 * @param ctx - the plugin context.
 * @param config - the plugin config with schemastery defaults applied.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    backend: config.backend === 'openai-images' ? 'openai-images' : 'comfyui',
    comfyuiUrl: typeof config.comfyuiUrl === 'string' && config.comfyuiUrl.trim() !== '' ? config.comfyuiUrl.trim() : 'http://127.0.0.1:8188',
    comfyuiCheckpoint: typeof config.comfyuiCheckpoint === 'string' && config.comfyuiCheckpoint.trim() !== '' ? config.comfyuiCheckpoint.trim() : 'sd_xl_turbo_1.0_fp16.safetensors',
    comfyuiSteps: typeof config.comfyuiSteps === 'number' && config.comfyuiSteps > 0 ? config.comfyuiSteps : 2,
    comfyuiCfg: typeof config.comfyuiCfg === 'number' && config.comfyuiCfg >= 1 ? config.comfyuiCfg : 1,
    comfyuiDir: typeof config.comfyuiDir === 'string' ? config.comfyuiDir.trim() : '',
    comfyuiPythonPath: typeof config.comfyuiPythonPath === 'string' ? config.comfyuiPythonPath.trim() : '',
    comfyuiStartupTimeoutMs: typeof config.comfyuiStartupTimeoutMs === 'number' && config.comfyuiStartupTimeoutMs > 0 ? config.comfyuiStartupTimeoutMs : 120_000,
    comfyuiExtraArgs: typeof config.comfyuiExtraArgs === 'string' ? config.comfyuiExtraArgs.trim() : '',
    comfyuiFineUnet: typeof config.comfyuiFineUnet === 'string' ? config.comfyuiFineUnet.trim() : '',
    comfyuiFineClip: typeof config.comfyuiFineClip === 'string' ? config.comfyuiFineClip.trim() : '',
    comfyuiFineClipType: typeof config.comfyuiFineClipType === 'string' && config.comfyuiFineClipType.trim() !== '' ? config.comfyuiFineClipType.trim() : 'qwen_image',
    comfyuiFineVae: typeof config.comfyuiFineVae === 'string' ? config.comfyuiFineVae.trim() : '',
    comfyuiFineSteps: typeof config.comfyuiFineSteps === 'number' && config.comfyuiFineSteps > 0 ? config.comfyuiFineSteps : 25,
    comfyuiFineCfg: typeof config.comfyuiFineCfg === 'number' && config.comfyuiFineCfg >= 1 ? config.comfyuiFineCfg : 1,
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() !== '' ? config.baseUrl.trim() : 'https://api.siliconflow.cn/v1',
    model: typeof config.model === 'string' && config.model.trim() !== '' ? config.model.trim() : 'black-forest-labs/FLUX.1-schnell',
    apiKeyEnv: typeof config.apiKeyEnv === 'string' && config.apiKeyEnv.trim() !== '' ? config.apiKeyEnv.trim() : 'IMAGE_GEN_API_KEY',
    size: typeof config.size === 'string' && SIZE_PATTERN.test(config.size.trim()) ? config.size.trim() : '1024x1024',
    timeoutMs: typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs : 120_000,
  }
  if (resolved.backend === 'openai-images' && resolveFineFiles(resolved) !== undefined) {
    throw new Error('image-gen: the openai-images backend has no local tiers — clear the comfyuiFine* file fields or switch backend to comfyui')
  }
  const fineFiles = resolveFineFiles(resolved)
  if (fineFiles !== undefined && resolved.comfyuiDir !== '') {
    // A missing fine-tier file fails the load loudly: silently falling back to
    // the fast tier would surface only as quality loss much later.
    validateFineTierFiles(resolved.comfyuiDir, fineFiles)
  }
  let sidecar: ComfyuiSidecar | undefined
  if (resolved.backend === 'comfyui' && resolved.comfyuiDir !== '') {
    const target = parseLoopbackOrigin(resolved.comfyuiUrl)
    if (target === undefined) {
      throw new Error(`image-gen: managed ComfyUI startup needs a loopback http origin, got "${resolved.comfyuiUrl}" — clear comfyuiDir to manage the server yourself`)
    }
    const settings = {
      comfyuiDir: resolved.comfyuiDir,
      pythonPath: resolved.comfyuiPythonPath,
      origin: resolved.comfyuiUrl.replace(/\/+$/u, ''),
      host: target.host,
      port: target.port,
      startupTimeoutMs: resolved.comfyuiStartupTimeoutMs,
      extraArgs: resolved.comfyuiExtraArgs,
    }
    // A broken checkout or interpreter fails the load loudly: the operator
    // asked for a managed server, and silently skipping would surface only
    // as failed renders much later.
    validateSidecarFiles(settings)
    sidecar = createComfyuiSidecar(ctx.logger, settings)
    ctx.effect(() => () => sidecar?.dispose(), 'comfyui-sidecar')
    // Boot warms the server without blocking the profile; a failure logs and
    // the first render retries through ensureRunning.
    void sidecar.ensureRunning().catch((error: unknown) => {
      ctx.logger.error('ComfyUI startup failed: %s', error instanceof Error ? error.message : String(error))
    })
  }
  ctx.inject(['attachments'], () => { registerTool(ctx, resolved, sidecar, fineFiles) })
}
