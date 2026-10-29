import { clientBundle } from '../tsdown.client.ts'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-settings-account', ['lib/types/index.js'])

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'account-onboarding-icons',
    // The step icons are a few hundred bytes each and are used as mask images,
    // so they ride along as data URIs. The step artwork is megabytes of PNG
    // that only the Desktop onboarding shows: the Web shell serves it as
    // static files instead, so the client bundle carries no image bytes.
    resolveId(source: string) {
      if (!/^\.\/assets\/[^/]+\.svg$/.test(source)) return null
      const url = new URL(`./src/client/assets/${basename(source)}`, import.meta.url)
      return fileURLToPath(url)
    },
    async load(id: string) {
      if (!/\/ui-settings-account\/src\/client\/assets\/[^/]+\.svg$/.test(id.replaceAll('\\', '/'))) return null
      this.addWatchFile(id)
      const data = await readFile(id)
      return `export default ${JSON.stringify(`data:image/svg+xml;base64,${data.toString('base64')}`)}`
    },
  }],
}))) satisfies typeof bundle
