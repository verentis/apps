// Accounting views from the design: journals, paid expenses and periods as lists.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'journals.page.yaml', id: 'accounting-journals', name: 'Journals', description: 'Every journal, drafts to post first.', icon: 'notebook-pen', container: containers.journals.path, mime: mimeTypes.journal,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, date: e.data.date, description: e.data.description || '', status: e.data.status || 'draft', lines: (e.data.lines || []).length, from: e.data.postedBy && e.data.postedBy.app ? e.data.postedBy.app : '' })).sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1) || (a.date < b.date ? 1 : -1))",
      columns: [['code', 'Journal'], ['date', 'Date', undefined, 'date'], ['description', 'Description'], ['lines', 'Lines', 'end'], ['from', 'Posted by'], ['status', 'Status', undefined, 'badge']], empty: 'No journals yet.' }),
    listPage({ file: 'expenses.page.yaml', id: 'accounting-expenses', name: 'Expenses', description: 'Paid expenses with their receipts; posting writes their journal.', icon: 'receipt', container: containers.expenses.path, mime: mimeTypes.expense,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, date: e.data.date, payee: e.data.payee || '', description: e.data.description || '', gross: e.data.grossAmount || '', status: e.data.status || 'draft' })).sort((a, b) => a.date < b.date ? 1 : -1)",
      columns: [['code', 'Expense'], ['date', 'Date', undefined, 'date'], ['payee', 'Payee'], ['description', 'Description'], ['gross', 'Gross', 'end'], ['status', 'Status', undefined, 'badge']], empty: 'No expenses yet.' }),
    listPage({ file: 'periods.page.yaml', id: 'accounting-periods', name: 'Periods', description: 'Open and closed periods; close one from its form, with its checklist.', icon: 'calendar-range', container: containers.periods.path, mime: mimeTypes.period,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', from: e.data.startDate, to: e.data.endDate, status: e.data.status || 'open' })).sort((a, b) => a.from < b.from ? 1 : -1)",
      columns: [['code', 'Code'], ['name', 'Period'], ['from', 'From', undefined, 'date'], ['to', 'To', undefined, 'date'], ['status', 'Status', undefined, 'badge']], empty: 'No periods yet.' }),
  ]
}
