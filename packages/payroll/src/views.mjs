// What Payroll adds to its generated pages: pay runs by where they stand.
import { board } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.runs.path, script: postScriptPath, field: 'status', run: {computed: 'compute-run', approved: 'approve-run', posted: 'post-run'}, edit: false, final: ['posted'], confirm: {posted: 'Posting writes the payroll journal.'} },
    label: 'Pay runs',
    top: [board("{{ (data.runs || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived') }}", 'data.status', [{ value: 'draft', label: 'Draft' }, { value: 'computed', label: 'Computed' }, { value: 'approved', label: 'Approved' }, { value: 'posted', label: 'Posted' }], { title: 'data.period', code: 'data.code', meta: ['data.currency'] })],
  },
  'structures.page.yaml': { label: 'Structures', icon: 'layers' },
}
