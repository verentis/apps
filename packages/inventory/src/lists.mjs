// Inventory views from the design: count sessions, and the warehouses with their locations.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'counts.page.yaml', id: 'inventory-counts', name: 'Counts', description: 'Stock counts; open a draft one to continue counting.', icon: 'clipboard-check', container: containers.adjustments.path, mime: mimeTypes.adjustment,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, date: e.data.date, product: String(e.data.product || '').split('/').pop(), warehouse: String(e.data.warehouse || '').split('/').pop(), location: e.data.location || '', counted: e.data.countedQty, status: e.data.status || 'draft' })).sort((a, b) => a.date < b.date ? 1 : -1)",
      columns: [['code', 'Count'], ['date', 'Date', undefined, 'date'], ['product', 'Product'], ['warehouse', 'Warehouse'], ['location', 'Location'], ['counted', 'Counted', 'end'], ['status', 'Status', undefined, 'badge']], empty: 'No counts yet.' }),
    listPage({ file: 'warehouses.page.yaml', id: 'inventory-warehouses', name: 'Warehouses', description: 'Warehouses with their locations.', icon: 'warehouse', container: containers.warehouses.path, mime: mimeTypes.warehouse,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', locations: (e.data.locations || []).join(', ') }))",
      columns: [['code', 'Code'], ['name', 'Warehouse'], ['locations', 'Locations']], empty: 'No warehouses yet.' }),
  ]
}
