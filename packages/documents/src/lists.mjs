// Documents views from the design: every document as a table, and the tag vocabulary.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'all.page.yaml', id: 'documents-all', name: 'All documents', description: 'Every document card; filter by workspace, tag or status.', icon: 'files', container: containers.cards.path, mime: mimeTypes.document,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', workspace: String(e.data.workspace || '').split('/').pop(), tags: (e.data.tags || []).map(t => String(t).split('/').pop()).join(', '), owner: e.data.owner || '', status: e.data.status || 'inbox' }))",
      columns: [['code', 'Code'], ['title', 'Title'], ['workspace', 'Workspace'], ['tags', 'Tags'], ['owner', 'Owner'], ['status', 'Status', undefined, 'badge']], empty: 'No documents yet.' }),
    listPage({ file: 'tags.page.yaml', id: 'documents-tags', name: 'Tags', description: 'The curated tag vocabulary.', icon: 'tags', container: containers.tags.path, mime: mimeTypes.tag,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, label: e.data.label || '', category: e.data.category || '' }))",
      columns: [['code', 'Code'], ['label', 'Tag'], ['category', 'Category']], empty: 'No tags yet.' }),
  ]
}
