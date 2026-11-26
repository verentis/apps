// What Expenses adds to its generated pages: reports by status and spend per category.
import { board, chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': { label: 'My reports' },
  'reports.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.reports.path, script: postScriptPath, field: 'status', run: { submitted: 'submit-report', approved: { operation: 'approve-report', ask: [{ key: 'approver', label: 'Approved by', required: true, placeholder: 'Your name' }] }, posted: 'post-report' }, edit: false, final: ['posted'], confirm: {posted: 'Posting writes the expense journal.'} },
    label: 'All reports', icon: 'kanban', count: "{{ (data.rows || []).filter(r => r.status === 'submitted').length }}",
    top: [board("{{ (data.rows || []).filter(r => r.status !== 'refused') }}", 'status', [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'approved', label: 'Approved' }, { value: 'posted', label: 'Posted' }], { title: 'employee', code: 'code', meta: ['date', 'approver'], trailing: 'total' })],
  },
  'by-category.page.yaml': {
    label: 'Categories', icon: 'tags',
    top: [section('Spend per category', [chart("{{ (data.summary || []).map(s => ({ path: s.path, label: s.name || s.code, value: (s.amount || 0) / 100 })) }}",
      { kind: 'hbar', x: 'label', y: 'value', format: 'number', decimals: 2, sort: '-value' })])],
  },
}
