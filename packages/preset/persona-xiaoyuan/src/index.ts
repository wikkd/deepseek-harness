/**
 * 小圆 identity overlay for every agent preset.
 *
 * Presets own their persona text, and third-party presets may carry a generic
 * software-engineer identity that never names the product. This row keeps the
 * assembled `deployment:persona-prefix` section faithful to 小圆 without
 * editing any preset composition: when the persona does not already contain one
 * of the configured names, it prepends one short identity line. The section is
 * modified in place, so preset-owned prompt filters that retain the persona
 * section retain this line as well.
 *
 * @module @deepseek-ai/dsh-persona-xiaoyuan
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'persona-xiaoyuan'

/** Prompt assembly must exist before the overlay can read it. */
export const inject = ['systemPrompt']

/** Default identity line inserted before a persona that does not name 小圆. */
export const DEFAULT_IDENTITY = '你是小圆（鹿目圆），一位亲切、能干的中文助手。无论当前工作模式是什么，你都以小圆自称，不要自称其他名字。'

/** Plugin config: the identity line and the names that mark a persona as already identified. */
export interface Config {
  /** Line prepended to a persona that contains none of {@link Config.names}. */
  identity: string
  /** Names that mark a persona as already carrying the product identity. */
  names: string[]
}

/** Runtime schema for the identity overlay. */
export const Config: z<Config> = z.object({
  identity: z.string().default(DEFAULT_IDENTITY),
  names: z.array(z.string()).default(['小圆', '鹿目圆']),
})

/**
 * Add the configured identity to an assembly's persona section when missing.
 *
 * The function is pure and idempotent: a persona that already contains one of
 * the configured names is returned untouched, and only the persona section is
 * rebuilt. Assemblies without a persona section pass through unchanged.
 * @param assembly - prompt assembly produced by the system-prompt waterfall.
 * @param config - effective identity overlay configuration.
 * @returns the original assembly, or a copy with the identity prepended.
 */
export function applyIdentity(assembly: PromptAssembly, config: Config): PromptAssembly {
  const persona = assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)
  if (persona === undefined) return assembly
  if (config.names.some(entry => persona.text.includes(entry))) return assembly
  return {
    ...assembly,
    sections: assembly.sections.map(section => section === persona
      ? { ...section, text: `${config.identity}\n\n${section.text}` }
      : section),
  }
}

/**
 * Register the identity overlay on the system-prompt assembly waterfall.
 *
 * The listener runs inside the waterfall's `next()` chain. A preset prompt
 * filter registered with `prepend` narrows the result after this listener
 * returns, so modifying the existing persona section (rather than adding a new
 * section) is what lets the line survive that narrowing.
 * @param ctx - plugin context carrying the system-prompt service.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    return applyIdentity(await next(), config)
  })
}
