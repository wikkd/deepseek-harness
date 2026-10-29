/**
 * REAL-composition proof: the shipped YAML shape boots through the vendored
 * Loader, the function plugin's namespace survives (no default export), and a
 * generic preset persona reaches the model carrying the 小圆 identity.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Xiaoyuan from '@deepseek-ai/dsh-persona-xiaoyuan'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Import mapped source modules without claiming support for Node's HMR internals. */
function sourceModuleLoader(importModule: (specifier: string) => Promise<unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    import: importModule,
    loadCache: new Map(),
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
}

/**
 * Boot a cordis.yml carrying the system prompt and the identity overlay.
 * @param configLines - YAML lines under the overlay's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-persona-xiaoyuan-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '  config:',
    '    personaPrefix: You are a helpful software engineer assistant.',
    "- name: '@deepseek-ai/dsh-persona-xiaoyuan'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-persona-xiaoyuan', Xiaoyuan],
  ])
  ctx.loader.internal = sourceModuleLoader(async (specifier) => {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('the identity overlay through a real Loader composition', () => {
  it('adds the configured line to the assembled system prompt', async () => {
    const ctx = await boot([
      '    identity: 你是小圆（鹿目圆）。',
      '    names:',
      '      - 小圆',
      '      - 鹿目圆',
    ])

    const rendered = renderPrompt(await ctx.systemPrompt.assemble())
    expect(rendered).toContain('你是小圆（鹿目圆）。\n\nYou are a helpful software engineer assistant.')
  }, 30_000)

  it('uses the default identity when the config is omitted', async () => {
    const ctx = await boot([])
    const rendered = renderPrompt(await ctx.systemPrompt.assemble())
    expect(rendered).toContain(Xiaoyuan.DEFAULT_IDENTITY)
    expect(rendered).toContain('You are a helpful software engineer assistant.')
  }, 30_000)

  it('keeps the function-plugin namespace free of a default export', () => {
    expect('default' in Xiaoyuan).toBe(false)
  })
})
