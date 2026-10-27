import type { Compiler } from 'webpack'

/** Keep Taro's RAF polyfill from importing its own uninitialized runtime export. */
export default class MiniRuntimeRafGuard {
  apply(compiler: Compiler) {
    const name = 'MiniRuntimeRafGuard'
    compiler.hooks.compilation.tap(name, (_compilation, { normalModuleFactory }) => {
      for (const type of ['javascript/auto', 'javascript/dynamic', 'javascript/esm']) {
        normalModuleFactory.hooks.parser.for(type).tap({ name, stage: -100 }, parser => {
          for (const identifier of ['requestAnimationFrame', 'cancelAnimationFrame']) {
            // Stop ProvidePlugin for these two identifiers in this implementation only.
            // All other modules retain the normal globals; Taro's timer fallback stays intact.
            parser.hooks.expression.for(identifier).tap({ name, stage: -100 }, () => {
              const resource = (parser.state.module as { resource?: string }).resource || ''
              if (/[\\/]@tarojs[\\/]runtime[\\/]dist[\\/]bom[\\/]raf\.js$/.test(resource)) return true
            })
          }
        })
      }
    })
  }
}
