/** Host configuration embeds the sidebar presentation in browser pages. */
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { expect, it, onTestFinished } from 'vitest'
import { Config, WORKSPACE_CONFIG_GLOBAL } from '../src/config.ts'
import * as host from '../src/index.ts'

it('defaults to the Workspace browser and accepts the conversation-only presentation', () => {
  expect(host.Config).toBe(Config)
  expect(Config({})).toEqual({ sidebar: 'workspaces' })
  expect(Config({ sidebar: 'conversations' })).toEqual({ sidebar: 'conversations' })
  // @ts-expect-error runtime validation must reject an unknown sidebar value
  expect(() => Config({ sidebar: 'unknown' })).toThrow()
})

it('embeds the sidebar presentation and withdraws it on disposal', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const config = Config({ sidebar: 'conversations' })
  const fiber = ctx.plugin(host, config)
  await fiber.await()
  const rows: IndexInjection[] = []
  ctx.emit('webserver/index-inject', rows)
  expect(rows).toEqual([{ kind: 'global', name: WORKSPACE_CONFIG_GLOBAL, value: config }])
  await fiber.dispose()
  const after: IndexInjection[] = []
  ctx.emit('webserver/index-inject', after)
  expect(after).toEqual([])
})
