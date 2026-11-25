// What Purchase adds to its generated pages: the orders board and expected deliveries.
import { board, section, timeStrip } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const active = "(data.orderrows || []).filter(o => o.status !== 'cancelled')"

export const views = {
  'home.page.yaml': {
    top: [section('Expected deliveries', [timeStrip("{{ (data.orderrows || []).filter(o => ['sent', 'confirmed'].includes(o.status) && !!o.expectedDate).map(o => ({ path: o.path, title: [o.code, o.vendorName].filter(part => part).join(' · '), at: o.expectedDate })) }}",
      { at: 'at', title: 'title', window: { from: '-7d', to: '21d' }, soon: '3d' })], 'Sent and confirmed orders by the date they are expected.')],
  },
  'orders.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.orders.path, script: postScriptPath, field: 'status', run: {confirmed: 'confirm-order', received: 'receive-order'}, edit: false, final: ['received'], confirm: {received: 'Every line is received in full.'} },
    label: 'Orders', icon: 'kanban', count: "{{ (data.orderrows || []).filter(o => o.status === 'confirmed').length }}",
    top: [board(`{{ ${active} }}`, 'status', [{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'received', label: 'Received' }], { title: 'vendorName', code: 'code', meta: ['reference', 'expectedDate'], trailing: 'total' })],
  },
  'vendors.page.yaml': { label: 'Vendors', icon: 'store' },
}
