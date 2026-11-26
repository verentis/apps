// Manufacturing views from the design: the shop floor's operation queue — what is running now and what is next.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

// The workcenter of an operation comes from the order's bill of materials (its routing step of the same name).
const workcenter = "(((((data.boms || []).find(b => b.path === e.data.bom) || {}).data || {}).routing || []).find(r => r.operation === o.label) || {}).workcenter || ''"
export function listPages() {
  return [
    listPage({ file: 'queue.page.yaml', id: 'manufacturing-queue', name: 'Operation queue', description: "What is running now and what is next on the shop floor, by workcenter.", icon: 'factory',
      container: containers.orders.path, mime: mimeTypes.order,
      extra: { boms: { kind: 'folder', path: containers.boms.path, contents: true, 'mime-pattern': mimeTypes.bom } },
      access: [{ path: containers.boms.path, reason: 'Name the workcenter of each operation' }],
      rows: "RECORDS.filter(e => e.data.status === 'in-progress' || e.data.status === 'confirmed').reduce((all, e) => all.concat((e.data.operations || []).map((o, i, ops) => ({ path: e.path, order: e.data.code || e.name, product: e.data.productName || '', operation: o.label,"
        + ` workcenter: ${workcenter}, state: o.done ? 'Done' : o.startedAt ? 'Running' : ops.findIndex(x => !x.done) === i ? 'Next' : 'Waiting', started: o.startedAt || '', minutes: o.seconds ? Math.round(o.seconds / 60) : '' })).filter(r => r.state !== 'Done')), [])`
        + ".sort((a, b) => (a.state === 'Running' ? 0 : a.state === 'Next' ? 1 : 2) - (b.state === 'Running' ? 0 : b.state === 'Next' ? 1 : 2) || (a.workcenter < b.workcenter ? -1 : 1))",
      columns: [['state', 'State', undefined, 'badge'], ['workcenter', 'Workcenter'], ['operation', 'Operation'], ['order', 'Order'], ['product', 'Product'], ['started', 'Started', undefined, 'relative'], ['minutes', 'Minutes', 'end']],
      empty: 'Nothing is running or waiting on the shop floor.' }),
  ]
}
