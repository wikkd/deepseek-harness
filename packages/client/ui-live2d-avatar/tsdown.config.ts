import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

export default ((options) => clientBundle('@deepseek-ai/dsh-client-ui-live2d-avatar', ['lib/types/index.js'])(options)
  .map(config => ({
    ...config,
    inputOptions: {
      ...config.inputOptions,
      resolve: {
        ...config.inputOptions?.resolve,
        // @pixi/utils' CJS build top-level-requires the Node `url` builtin from
        // its deprecated helpers (lib/url.js), and the package carries no browser
        // field, so bundling under browser conditions still pulls the builtin
        // into the browser bundle. The pet never touches those helpers; aliasing
        // the builtin to an empty module keeps the require resolvable at runtime.
        alias: {
          url: fileURLToPath(new URL('./src/client/empty-module.ts', import.meta.url)),
        },
      },
    },
    outputOptions: {
      ...config.outputOptions,
      // The pixi stack must stay in one artifact: rolldown's default splitting
      // names pixi chunks by their npm entry paths (`client2.lib.js`, rejected
      // by the on-demand chunk route) and cross-references them with a sync
      // require the module table cannot serve for a lazily loaded chunk.
      // codeSplitting: false compiles every dynamic import into an in-place
      // module init — the entry chunk stays self-contained.
      codeSplitting: false,
    },
  })))
