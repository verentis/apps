// What Knowledge adds to its generated pages: articles by status per space.
import { chart, openRow, section } from '../../../tools/file-apps/canvas.mjs'

const spaces = "(data.rows || []).map(r => r.space || 'No space').filter((name, index, all) => all.indexOf(name) === index)"

export const views = {
  'home.page.yaml': { label: 'Spaces' },
  'spaces.page.yaml': {
    top: [section('Articles', [{
      type: 'canvas.tree',
      props: {
        rows: "{{ (data.articles || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived').map(e => ({ path: e.path, title: e.data.title || e.data.code, parent: e.data.parent || '', status: e.data.status, space: ((((data.spaces || []).find(s => s.path === e.data.space) || {}).data || {}).name) || 'No space' })) }}",
        idKey: 'path', parentKey: 'parent', label: 'title', groupBy: 'space', depth: 1,
        badge: { key: 'status', labels: { published: 'Published', draft: 'Draft', archived: 'Archived' }, tones: { published: 'success', draft: 'neutral', archived: 'warning' } },
      },
      on: { open: openRow },
    }], 'Articles nested under their parent article, per space.')],
    label: 'Space tree', icon: 'folder-tree',
    bottom: [section('Articles per space', [chart(`{{ ${spaces}.map(name => ({ label: name, published: (data.rows || []).filter(r => (r.space || 'No space') === name && r.status === 'published').length, draft: (data.rows || []).filter(r => (r.space || 'No space') === name && r.status === 'draft').length })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['published', 'draft'], labels: { published: 'Published', draft: 'Draft' }, palette: { published: 'success', draft: 'muted' }, format: 'integer' })])],
  },
  'recent.page.yaml': { label: 'Recent', icon: 'history' },
  'tags.page.yaml': { label: 'Tags', icon: 'tags' },
}
