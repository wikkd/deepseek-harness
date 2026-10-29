/**
 * Workspace picker plugin, node half. Projects the validated sidebar
 * presentation into browser pages; the browser half ships through
 * `exports["./client"]` and the `dsh.client` declaration. All other behavior
 * is browser-side.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'
import { WORKSPACE_CONFIG_GLOBAL } from './config.ts'

export { Config } from './config.ts'

/**
 * Embed the sidebar presentation in product pages.
 * @param ctx - Host context serving browser pages.
 * @param config - Sidebar presentation adopted when the page loads.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: WORKSPACE_CONFIG_GLOBAL, value: config })
  })
}
