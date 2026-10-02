import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-account-moldex', ['lib/types/index.js'])
const moldexMark = fileURLToPath(new URL('./src/client/moldex-mark.png', import.meta.url))
const MOLDEX_MARK_ID = '\0moldex-brand-mark.png'

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'moldex-brand-mark',
    resolveId(source: string, importer: string | undefined) {
      if (source !== './moldex-mark.png') return null
      if (importer === undefined) return null
      const normalized = importer.replaceAll('\\', '/')
      if (!normalized.endsWith('/client/Brand.js') && !normalized.endsWith('/client/Brand.tsx')) return null
      return MOLDEX_MARK_ID
    },
    async load(id: string) {
      if (id !== MOLDEX_MARK_ID) return null
      this.addWatchFile(moldexMark)
      const image = await readFile(moldexMark)
      return `export default ${JSON.stringify(`data:image/png;base64,${image.toString('base64')}`)};`
    },
  }],
}))) satisfies typeof bundle
