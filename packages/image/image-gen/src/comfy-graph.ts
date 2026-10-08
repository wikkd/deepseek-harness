/**
 * The two ComfyUI text-to-image graphs the tiered router picks between:
 * the checkpoint `fast` graph (single-file model, SDXL-Turbo) and the GGUF
 * `fine` graph (separate UNet/CLIP/VAE loaders, Qwen-Image). Both end in the
 * same SaveImage contract, so the submission/poll/download path stays shared.
 * @module
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** One ComfyUI API-format prompt graph: node id → class type + inputs. */
export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

/** Config slice naming the `fine`-tier GGUF model files inside the shared ComfyUI models directories. */
export interface FineTierFiles {
  /** GGUF diffusion model name under ComfyUI `models/diffusion_models`. */
  unet: string
  /** Text-encoder name under ComfyUI `models/text_encoders`. */
  clip: string
  /** CLIP loader `type` widget value (e.g. `qwen_image`). */
  clipType: string
  /** VAE name under ComfyUI `models/vae`. */
  vae: string
}

/**
 * Build the fast-tier graph: the standard single-checkpoint loader the
 * original plugin shipped with, tuned for turbo/distilled checkpoints.
 * @param checkpoint - checkpoint name under models/checkpoints.
 * @param prompt - the user's text prompt.
 * @param negativePrompt - negative prompt (empty keeps CFG-1 turbo behavior).
 * @param width - picture width in pixels.
 * @param height - picture height in pixels.
 * @param steps - sampler steps.
 * @param cfg - CFG guidance.
 * @param seed - sampler seed.
 * @returns the API-format graph.
 */
export function buildFastGraph(checkpoint: string, prompt: string, negativePrompt: string,
  width: number, height: number, steps: number, cfg: number, seed: number): ComfyGraph {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1,
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-image-gen', images: ['6', 0] } },
  }
}

/**
 * Build the fine-tier graph: GGUF UNet + standalone CLIP + VAE loaders, the
 * shape ComfyUI-GGUF and the operator's proven qwen-image workflow use.
 * @param files - the `fine`-tier model file names.
 * @param prompt - the user's text prompt.
 * @param negativePrompt - negative prompt.
 * @param width - picture width in pixels.
 * @param height - picture height in pixels.
 * @param steps - sampler steps.
 * @param cfg - CFG guidance.
 * @param seed - sampler seed.
 * @returns the API-format graph.
 */
export function buildFineGraph(files: FineTierFiles, prompt: string, negativePrompt: string,
  width: number, height: number, steps: number, cfg: number, seed: number): ComfyGraph {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: files.unet } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: files.clip, type: files.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: files.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '4n': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['2', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1,
        model: ['1', 0], positive: ['4', 0], negative: ['4n', 0], latent_image: ['5', 0],
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    '8': { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-image-gen', images: ['7', 0] } },
  }
}

/**
 * Validate that every `fine`-tier model file sits where its loader will look.
 * Runs at plugin load so a missing file fails loudly, mirroring the sidecar's
 * validate-at-load contract.
 * @param comfyuiDir - absolute ComfyUI checkout directory.
 * @param files - the `fine`-tier model file names.
 * @throws naming the first missing file and its models subdirectory.
 */
export function validateFineTierFiles(comfyuiDir: string, files: FineTierFiles): void {
  const checks: readonly { file: string; dir: string }[] = [
    { file: files.unet, dir: 'models/diffusion_models' },
    { file: files.clip, dir: 'models/text_encoders' },
    { file: files.vae, dir: 'models/vae' },
  ]
  for (const { file, dir } of checks) {
    if (file.trim() === '') throw new Error('image-gen fine-tier config is incomplete: a model file name is empty')
    if (!existsSync(join(comfyuiDir, dir, file))) {
      throw new Error(`image-gen fine-tier model "${file}" not found under "${comfyuiDir}/${dir}" — check comfyuiFine* config fields`)
    }
  }
}
