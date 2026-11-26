// PLM views from the design: every change order as a table.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'changes.page.yaml', id: 'plm-changes', name: 'Change orders', description: 'Every change order with its type, product, approver and dates.', icon: 'table-2', container: containers.ecos.path, mime: mimeTypes.eco,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', type: e.data.type || '', product: String(e.data.product || '').split('/').pop(), priority: e.data.priority || '', approver: e.data.approver || '', effective: e.data.effectiveDate || '', stage: e.data.stage || 'draft' }))",
      columns: [['code', 'ECO'], ['title', 'Title'], ['type', 'Type', undefined, 'badge'], ['product', 'Product / BoM'], ['priority', 'Priority', undefined, 'badge'], ['approver', 'Approver'], ['effective', 'Effective', undefined, 'date'], ['stage', 'Stage', undefined, 'badge']],
      empty: 'No change orders yet.' }),
  ]
}
