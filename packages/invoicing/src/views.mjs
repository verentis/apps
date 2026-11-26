// What Invoicing adds to its generated pages: receivables by age.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'

const open = "(data.receivables || []).filter(r => r.outstanding > 0)"
const days = "Math.floor((Date.now() - Date.parse(r.dueDate)) / 86400000)"
const bucket = (label, test) => `{ label: '${label}', value: ${open}.filter(r => ${test}).reduce((sum, r) => sum + r.outstanding, 0) / 100 }`

export const views = {
  'receivables.page.yaml': {
    label: 'Receivables', icon: 'hand-coins', count: `{{ ${open}.filter(r => r.overdue).length }}`, tone: 'danger',
    top: [section('Outstanding by age', [chart(`{{ [${bucket('current', '!r.overdue')}, ${bucket('1-30', `r.overdue && ${days} <= 30`)}, ${bucket('31-60', `r.overdue && ${days} > 30 && ${days} <= 60`)}, ${bucket('60+', `r.overdue && ${days} > 60`)}] }}`,
      { kind: 'strip', x: 'label', y: 'value', format: 'number', decimals: 2, labels: { 'current': 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days', '60+': 'Over 60 days' }, palette: { 'current': 'success', '1-30': 'chart-4', '31-60': 'warning', '60+': 'danger' }, emptyText: 'Nothing outstanding' })],
    'Issued invoices still owed, by how long past their due date.')],
  },
}
