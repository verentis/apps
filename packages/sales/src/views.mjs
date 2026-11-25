// What Sales adds to its generated pages: the quotation funnel and orders to deliver.
import { board, chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'

const quotations = "(data.quotations || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')"
const orders = "(data.orders || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')"

export const views = {
  'home.page.yaml': {
    top: [section('From quotation to order', [chart(`{{ [{ label: 'Quotations', value: ${quotations}.filter(e => e.data.status !== 'cancelled').length }, { label: 'Sent', value: ${quotations}.filter(e => ['sent', 'confirmed'].includes(e.data.status)).length }, { label: 'Confirmed', value: ${quotations}.filter(e => e.data.status === 'confirmed').length }, { label: 'Delivered', value: ${orders}.filter(e => e.data.deliveryStatus === 'delivered').length }] }}`,
      { kind: 'funnel', x: 'label', y: 'value', format: 'integer', emptyText: 'No quotations yet' })])],
  },
  'quotations.page.yaml': { label: 'Quotations', icon: 'file-text', count: `{{ ${quotations}.filter(e => e.data.status === 'sent').length }}` },
  'orders.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.orders.path, field: 'deliveryStatus', run: {}, edit: true },
    label: 'Orders', icon: 'package', count: `{{ ${orders}.filter(e => e.data.deliveryStatus !== 'delivered').length }}`,
    top: [board(`{{ ${orders} }}`, 'data.deliveryStatus', [{ value: 'pending', label: 'Pending' }, { value: 'partial', label: 'Partial' }, { value: 'delivered', label: 'Delivered' }], { title: 'data.customer.name', code: 'data.code', meta: ['data.date', 'data.quotation'] })],
  },
  'summary.page.yaml': { label: 'Summary', icon: 'chart-column' },
}
