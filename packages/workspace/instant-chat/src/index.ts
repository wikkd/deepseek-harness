/**
 * Instant chat: the web GUI must offer a conversation without the operator
 * picking a workspace first. dsh's built-in first-use default workspace
 * (`workspaceRegistry.initializeDefault`) only fires while the registry AND
 * the session history are both empty, and it permanently disables itself once
 * that default registration is deleted, so a deleted default dead-ends the GUI
 * on the workspace picker with nothing to select. This plugin closes both
 * traps: at boot, whenever the registry has no workspaces, it creates one —
 * first use or hundredth.
 * @module @deepseek-ai/dsh-instant-chat
 */

import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defaultDshHome, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'instant-chat'

/** Consumes the registry the base bundle's workspace package provides. */
export const inject = ['workspaceRegistry'] as const

/** Plugin config: where the fallback workspace lives and what it is called. */
export interface Config {
  /**
   * Default workspace directory. `~` expands against the OS home; a relative
   * path resolves against the host process cwd. Empty uses
   * `<DSH_HOME>/workspaces/default` (`DSH_HOME` defaults to `~/.xiaoyuan`).
   */
  path?: string
  /** Display title in the sidebar. Empty uses "Default". */
  title?: string
}

export const Config: z<Config> = z.object({
  path: z.string().description('Default workspace directory; empty uses <DSH_HOME>/workspaces/default.').default(''),
  title: z.string().description('Display title in the sidebar; empty uses "Default".').default(''),
})

/** Config after defaults, `~` expansion, and relative-path resolution. */
interface ResolvedConfig {
  path: string
  title: string
}

/**
 * Fill defaults and normalize the configured directory.
 * @param config the raw plugin config with schemastery defaults applied.
 * @returns the absolute fallback directory and its display title.
 */
function resolveConfig(config: Config): ResolvedConfig {
  const configured = typeof config.path === 'string' ? config.path.trim() : ''
  let path: string
  if (configured === '') {
    path = join(defaultDshHome(), 'workspaces', 'default')
  } else {
    const expanded = expandHomePath(configured)
    path = isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
  }
  const title = typeof config.title === 'string' && config.title.trim() !== '' ? config.title.trim() : 'Default'
  return { path, title }
}

/**
 * Ensure at least one workspace exists so the GUI's recent-workspace restore
 * can connect a conversation without user interaction. A populated registry is
 * left untouched — this plugin removes the dead-end, it never adds clutter.
 * `registry.create` is idempotent per canonical path, so coexisting with the
 * built-in first-use initialization is safe. Creation failures are logged,
 * not thrown: the workspace picker remains the manual fallback and a
 * convenience plugin must not fail the profile boot.
 * @param ctx the cordis context of this plugin entry.
 * @param config the plugin config with defaults applied.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const cfg = resolveConfig(config)
  // The Context augmentation lives in @deepseek-ai/dsh-workspace; the local
  // intersection keeps this file compiling even when that module is not part
  // of the compilation program.
  const registry = (ctx as Context & { workspaceRegistry: WorkspaceRegistry }).workspaceRegistry
  if (registry.list().length > 0) return
  try {
    await mkdir(cfg.path, { recursive: true })
    const workspace = await registry.create(cfg.path, cfg.title)
    ctx.logger.info('instant-chat: workspace "%s" ready at %s', cfg.title, workspace.path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn('instant-chat: could not ensure a default workspace: %s', message)
  }
}
