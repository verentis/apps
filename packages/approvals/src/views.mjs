// What Approvals adds to its generated pages: inbox counts and requests per type.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'

export const views = {
  'home.page.yaml': { label: 'Overview' },
  'pending.page.yaml': { label: 'Inbox', icon: 'inbox', count: "{{ (data.rows || []).filter(r => r.status === 'submitted').length }}" },
  'requests.page.yaml': { label: 'All requests', icon: 'list' },
  'by-type.page.yaml': {
    label: 'Types', icon: 'shapes',
    top: [section('Requests per type', [chart("{{ (data.summary || []).map(s => ({ path: s.path, label: s.name || s.code, submitted: s.submitted || 0, approved: s.approved || 0, refused: s.refused || 0 })) }}",
      { kind: 'stacked-hbar', x: 'label', y: ['submitted', 'approved', 'refused'], labels: { submitted: 'Waiting', approved: 'Approved', refused: 'Refused' }, palette: { submitted: 'warning', approved: 'success', refused: 'danger' }, format: 'integer' })])],
  },
}
