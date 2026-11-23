import { createApp, h } from 'vue'
import { ComponentRegistry, parseCanvasYaml } from '@verentis/canvas-core'
import { ActionEngine, CanvasDataGraph, createRuntimeContext } from '@verentis/canvas-data'
import { CanvasDocumentView } from '@verentis/canvas-renderer'
import { layoutPack } from '@verentis/canvas-components/layout'
import { contentPack } from '@verentis/canvas-components/content'
import { formPack } from '@verentis/canvas-components/form'

window.renderDocument = async ({ document, files, packs = [], binding, listings = {} }) => {
  const parsed = parseCanvasYaml(document)
  if (!parsed.model) throw Error(JSON.stringify(parsed.issues))
  const model = parsed.model
  const registry = new ComponentRegistry()
  for (const pack of [layoutPack, contentPack, formPack]) registry.registerPack(pack)
  const host = {
    async readFile(path) {
      if (!(path in files)) throw Error(`Missing fixture: ${path}`)
      return { content: JSON.stringify(files[path]), mimeType: 'application/json' }
    },
    async listFolder(path) {
      if (path === '/legal-authority-packs') return packs
      if (!(path in listings)) throw Error(`Unexpected listing: ${path}`)
      return listings[path]
    },
    async readFileSnapshot({ path, branch }) {
      if (path !== binding?.path) throw Error(`Unexpected bound record: ${path}`)
      const record = await window.readRecord(path)
      return { path, branch, nodeId: binding.nodeId, revision: '"00000000000000000000000000000001"',
        content: JSON.stringify(record), mimeType: binding.mimeType }
    },
    async writeFileSnapshot() { throw Error('This scenario changes records through the installed scripts, not a direct form save') },
    runScript: request => window.runPackageScript(request),
    grantedScopes: async () => ['file.read', 'file.write', 'execution.run', 'execution.read'],
  }
  const graph = new CanvasDataGraph(model.spec, { host, document: binding, ctx: createRuntimeContext({ file: binding }), onError: (_, error) => { throw error } })
  await graph.start()
  const actions = new ActionEngine({ graph, host, actions: model.spec.actions, ui: { confirm: async () => true }, onError: (name, error) => {
    console.error(name, error.message)
    throw error
  } })
  const runtime = {
    registry, scope: graph.scope, dispatch: (...args) => actions.dispatch(...args),
    actionStatus: ref => actions.status(ref), write: (path, value) => graph.write(path, value),
  }
  createApp({ render: () => h(CanvasDocumentView, { document: model, runtime }) }).mount('#app')
}
