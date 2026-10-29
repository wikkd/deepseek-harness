/** Sidebar presentation shared by the Host configuration and the browser plugin. */
import z from '@deepseek-ai/schemastery'

/** Browser global carrying the validated Host configuration into the page. */
export const WORKSPACE_CONFIG_GLOBAL = '__DSH_WORKSPACE_CONFIG__'

/** Sidebar presentation for deployments that hide directories from the operator. */
export interface Config {
  /**
   * `workspaces` keeps the workspace tree, picker, and add/rename actions.
   * `conversations` shows one flat Session list and removes workspace chrome
   * from the sidebar and the conversation hero.
   */
  sidebar: 'workspaces' | 'conversations'
}

/** Validated sidebar presentation. */
export const Config: z<Partial<Config>, Config> = z.object({
  sidebar: z.union(['workspaces', 'conversations']).default('workspaces'),
})
