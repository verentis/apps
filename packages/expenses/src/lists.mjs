// Expenses views from the design: my reports, and reports to approve.
import { listPage, mine } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

const reports = { container: containers.reports.path, mime: mimeTypes.report }
const row = "e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', date: e.data.date, total: e.data.total || '', receipts: (e.data.receipts || []).length, status: e.data.status || 'draft' })"
const columns = [['code', 'Report'], ['employee', 'Employee'], ['date', 'Date', undefined, 'date'], ['receipts', 'Receipts', 'end'], ['total', 'Total', 'end'], ['status', 'Status', undefined, 'badge']]
export function listPages() {
  return [
    // Theirs: linked to their Employees record (by work email), or carrying their name.
    listPage({ file: 'mine.page.yaml', id: 'expenses-mine', name: 'My reports', description: 'Your expense reports with their receipts and totals.', icon: 'user', ...reports, me: true,
      rows: `RECORDS.filter(e => ${mine('employeeName', 'employeeRecord')}).map(${row})`, columns, empty: 'You have no expense reports.' }),
    listPage({ file: 'to-approve.page.yaml', id: 'expenses-to-approve', name: 'To approve', description: 'Submitted reports to approve or refuse.', icon: 'circle-check', ...reports,
      rows: `RECORDS.filter(e => e.data.status === 'submitted').map(${row})`, columns, empty: 'Nothing to approve.' }),
  ]
}
