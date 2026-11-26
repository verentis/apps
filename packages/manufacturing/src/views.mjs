// What Manufacturing adds to its generated pages: the orders board and the production schedule.
import { board, calendar, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': {
    top: [section('Schedule', [calendar("{{ (data.orderrows || []).filter(o => !!o.scheduledDate && o.status !== 'cancelled').map(o => ({ path: o.path, title: [o.code, o.productName].filter(part => part).join(' · '), status: o.status, at: o.scheduledDate })) }}",
      { start: 'at', title: 'title', colorBy: 'status', view: 'month' })], 'Manufacturing orders by scheduled date.')],
  },
  'orders.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.orders.path, script: postScriptPath, field: 'status', run: {confirmed: 'confirm-mo', 'in-progress': 'start-mo', done: 'complete-mo'}, edit: false, final: ['done'], confirm: {done: 'Completing creates the stock moves in Inventory.'} },
    label: 'Orders', icon: 'kanban', count: "{{ (data.orderrows || []).filter(o => o.status === 'in-progress').length }}",
    top: [board("{{ (data.orderrows || []).filter(o => o.status !== 'cancelled') }}", 'status', [{ value: 'draft', label: 'Draft' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'in-progress', label: 'In progress' }, { value: 'done', label: 'Done' }], { title: 'productName', code: 'code', meta: ['quantity', 'scheduledDate'] })],
  },
  'boms.page.yaml': { label: 'Bills of materials', icon: 'list-tree' },
}
