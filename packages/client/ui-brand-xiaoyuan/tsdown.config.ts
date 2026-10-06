import { clientBundle } from '../tsdown.client.ts'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-brand-xiaoyuan', ['lib/types/index.js'])

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'brand-xiaoyuan-assets',
    resolveId(source: string) {
      if (!/^\.\/assets\/[^/]+\.png$/.test(source)) return null
      const url = new URL(`./src/client/assets/${basename(source)}`, import.meta.url)
      return fileURLToPath(url) + url.search
    },
    async load(id: string) {
      if (!/\/ui-brand-xiaoyuan\/src\/client\/assets\/[^/]+\.png$/.test(id.replaceAll('\\', '/'))) return null
      this.addWatchFile(id)
      const data = await readFile(id)
      return `export default ${JSON.stringify(`data:image/png;base64,${data.toString('base64')}`)}`
    },
  }],
}))) satisfies typeof bundle
