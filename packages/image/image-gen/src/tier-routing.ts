/**
 * Tier routing for the `generate_image` tool: which ComfyUI model renders the
 * picture. Two inputs decide — the model's own difficulty judgment through the
 * tool's `quality` argument, and the host's actual spare capacity probed from
 * ComfyUI's `/system_stats`. Simple asks route to the fast checkpoint, hard
 * asks and idle machines route to the fine GGUF model; a resource-tight host
 * always falls back to fast so a heavy render cannot starve the machine.
 * @module
 */

/** The quality tiers a caller can request. */
export type QualityTier = 'fast' | 'fine'

/** What the caller asked for vs. what the host can afford right now. */
export interface RoutingInputs {
  /** The model's difficulty judgment: `fast` (simple ask), `fine` (hard ask), or `auto` (undeclared). */
  quality: 'fast' | 'fine' | 'auto'
  /** Free system RAM in GiB as reported by ComfyUI `/system_stats`; undefined when the probe failed. */
  freeRamGiB: number | undefined
  /** Free VRAM in GiB as reported by ComfyUI `/system_stats`; undefined when the probe failed. */
  freeVramGiB: number | undefined
  /** Whether the fine-tier model files are present and validated. */
  fineAvailable: boolean
  /** Backend that owns routing: `comfyui` routes by tier, `openai-images` ignores it. */
  backend: 'comfyui' | 'openai-images'
}

/** One routing decision plus the reason the router gives back to the envelope. */
export interface RoutingDecision {
  /** The tier that will render. */
  tier: QualityTier
  /** One-line reason for the envelope; stable phrasing for tests. */
  reason: string
}

/** Spare RAM below which the host is considered resource-tight for the fine tier. */
const FINE_MIN_FREE_RAM_GIB = 4
/** Spare VRAM below which the fine GGUF render would likely spill to system RAM. */
const FINE_MIN_FREE_VRAM_GIB = 4

/** The slice of ComfyUI `/system_stats` the router reads. */
interface SystemStatsPayload {
  /** RAM figures sit at the system level on current ComfyUI builds. */
  system?: { comfyui_version?: string; ram_free?: number; ram_total?: number }
  devices?: {
    name?: string
    type?: string
    vram_free?: number
    vram_total?: number
  }[]
}

/**
 * Probe ComfyUI's spare RAM/VRAM from `/system_stats`. RAM is reported at the
 * system level, VRAM per device; both convert to GiB. A failed or malformed
 * probe answers undefined fields and constrains nothing — routing then rests
 * on the quality argument alone rather than refusing to render.
 * @param origin - ComfyUI server origin without a trailing slash.
 * @returns free RAM/VRAM in GiB where reported, undefined fields otherwise.
 */
export async function probeComfyuiStats(origin: string): Promise<{ freeRamGiB?: number; freeVramGiB?: number }> {
  try {
    const response = await fetch(`${origin}/system_stats`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return {}
    const payload = await response.json() as SystemStatsPayload
    const ramFree = typeof payload.system?.ram_free === 'number' && payload.system.ram_free > 0
      ? payload.system.ram_free / (1024 ** 3)
      : undefined
    const device = payload.devices?.[0]
    const vramFree = typeof device?.vram_free === 'number' && device.vram_free > 0
      ? device.vram_free / (1024 ** 3)
      : undefined
    return { ...(ramFree === undefined ? {} : { freeRamGiB: ramFree }), ...(vramFree === undefined ? {} : { freeVramGiB: vramFree }) }
  } catch {
    return {}
  }
}

/**
 * Decide which tier renders one picture. Ordered from the hard resource
 * ceiling down: a tight host wins over every quality preference; then
 * availability, then the caller's declared difficulty, with `auto` resolving
 * to fine on an idle host (the user's "prefer the big model when the machine
 * is free" directive) and fast otherwise.
 * @param inputs - the caller's request and the host's probed spare capacity.
 * @returns the tier to render with and the reason for the envelope.
 */
export function decideTier(inputs: RoutingInputs): RoutingDecision {
  if (inputs.backend !== 'comfyui') {
    return { tier: 'fast', reason: 'the configured backend is the hosted images API' }
  }
  if (!inputs.fineAvailable) {
    return { tier: 'fast', reason: 'the fine-tier model files are not configured or missing' }
  }
  if (inputs.freeRamGiB !== undefined && inputs.freeRamGiB < FINE_MIN_FREE_RAM_GIB) {
    return { tier: 'fast', reason: `free system RAM ${inputs.freeRamGiB.toFixed(1)} GiB is below the ${FINE_MIN_FREE_RAM_GIB} GiB headroom the fine tier needs` }
  }
  if (inputs.freeVramGiB !== undefined && inputs.freeVramGiB < FINE_MIN_FREE_VRAM_GIB) {
    return { tier: 'fast', reason: `free VRAM ${inputs.freeVramGiB.toFixed(1)} GiB is below the ${FINE_MIN_FREE_VRAM_GIB} GiB headroom the fine tier needs` }
  }
  if (inputs.quality === 'fine') {
    return { tier: 'fine', reason: 'the model judged the task demanding' }
  }
  if (inputs.quality === 'fast') {
    return { tier: 'fast', reason: 'the model judged the task simple' }
  }
  return { tier: 'fine', reason: 'quality undeclared and the host has headroom' }
}
