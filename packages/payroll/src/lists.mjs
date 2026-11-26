// Payroll views from the design: one payslip per employee per posted run.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'payslips.page.yaml', id: 'payroll-payslips', name: 'Payslips', description: 'One payslip per employee per posted pay run; a row opens its run.', icon: 'file-text', container: containers.runs.path, mime: mimeTypes.payrun,
      rows: "RECORDS.filter(e => e.data.status === 'posted').reduce((all, e) => all.concat((e.data.payslips || []).map(p => ({ path: e.path, run: e.data.code || e.name, period: e.data.period, employee: p.employeeName || p.employee || '', gross: p.gross, deductions: p.deductions, net: p.net }))), []).sort((a, b) => (b.period + a.employee) < (a.period + b.employee) ? -1 : 1)",
      columns: [['period', 'Period'], ['employee', 'Employee'], ['gross', 'Gross', 'end'], ['deductions', 'Deductions', 'end'], ['net', 'Net', 'end'], ['run', 'Pay run']], empty: 'No posted pay runs yet.' }),
  ]
}
