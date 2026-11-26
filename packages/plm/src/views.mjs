// What PLM adds to its generated pages: the change-order board.
import { board } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.ecos.path, script: postScriptPath, field: 'stage', run: {'in-review': 'submit-review', approved: 'approve', rejected: 'reject', applied: 'apply'}, edit: false, final: ['applied'], confirm: {applied: 'The change is applied to the bill of materials.'} },
    label: 'Board', icon: 'kanban',
    top: [board('{{ data.ecorows || [] }}', 'stage', [{ value: 'draft', label: 'Draft' }, { value: 'in-review', label: 'In review' }, { value: 'approved', label: 'Approved' }, { value: 'applied', label: 'Applied' }, { value: 'rejected', label: 'Rejected' }], { title: 'title', code: 'code', meta: ['type', 'effectiveDate'], badge: 'priority' })],
  },
}
