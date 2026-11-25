// What Accounting adds to its generated pages: income against expenses, and what the position is made of.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'

const amount = "Math.abs(b.units || 0) / 100"

export const views = {
  'reports.page.yaml': {
    label: 'Reports', icon: 'chart-column',
    bottom: [
      section('Income and expenses', [chart(`{{ (data.period || []).filter(b => ['income', 'expense'].includes(b.type) && b.units !== 0).map(b => ({ label: b.number + ' ' + b.name, value: ${amount}, type: b.type })) }}`,
        { kind: 'hbar', x: 'label', y: 'value', format: 'number', decimals: 2, sort: '-value', limit: 12, emptyText: 'Nothing posted in this period' })], 'The largest income and expense accounts of the period.'),
      section('Position', [chart(`{{ ['asset', 'liability', 'equity'].map(type => ({ label: type, value: (data.position || []).filter(b => b.type === type).reduce((sum, b) => sum + ${amount}, 0) })) }}`,
        { kind: 'strip', x: 'label', y: 'value', format: 'number', decimals: 2, labels: { asset: 'Assets', liability: 'Liabilities', equity: 'Equity' }, emptyText: 'Nothing posted yet' })]),
    ],
  },
}
