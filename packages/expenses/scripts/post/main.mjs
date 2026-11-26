// Moves Expenses reports through their statuses and posts approved reports to the Accounting ledger. Canvas forms
// run this script (run-script) against a saved record; it validates the lines, computes the total, checks the chart
// of accounts and the open periods, writes the journal and marks the report, with the file access its installer
// consented to (manifest `file-access`).
//
// Integrity model: journals get deterministic names (`/journals/EXP-0001`) and are created create-only, so a
// retried operation never posts twice; records are updated conditionally (If-Match), so a concurrent edit fails
// instead of being overwritten. The steps are not one transaction: if a run stops between writing the journal and
// updating the report, running the same operation again completes it.
import {
  journalRequest, postedJournalFor, fail, formatMinor, journalLine, ledgerSettings, nameOf, nowIso, openPeriodFor,
  readAccounts, readRecord, readSettings, saveRecord, toMinor,
} from './ledger.mjs'
import { withAppCalls } from './app-calls.mjs'

export const operations = ['submit-report', 'approve-report', 'refuse-report', 'post-report', 'complete-report']
export const expenses = {
  settingsPath: '/settings/expenses.json',
  categories: '/expense-categories',
  reports: '/expense-reports',
  mime: kind => `application/vnd.verentis.expenses.${kind}+json`,
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This report'
const statusLabel = record => record.status || 'draft'

async function readReport(files, path) {
  const report = await readRecord(files, checkPath(path, expenses.reports), 'report')
  if (report.record.state === 'archived') fail(`${label(report.record)} is archived. Restore it first.`)
  return report
}

/**
 * Validates the report's lines (each needs a category in the categories container, a description, a positive
 * amount and at most an optional valid date) and returns the exact total in minor units.
 */
export function reportTotal(lines, digits) {
  if (!Array.isArray(lines) || lines.length === 0) fail('Add at least one expense line.')
  let total = 0n
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`
    if (typeof line.category !== 'string' || !line.category.startsWith(`${expenses.categories}/`)) {
      fail(`${at} needs a category from ${expenses.categories}.`)
    }
    if (!String(line.description ?? '').trim()) fail(`${at} needs a description.`)
    const amount = toMinor(line.amount, digits, `${at} amount`)
    if (amount === 0n) fail(`${at} has no amount.`)
    if (line.date && !datePattern.test(line.date)) fail(`${at} has an invalid date.`)
    total += amount
  })
  return total
}

export async function submitReport(files, path, { now }) {
  const report = await readReport(files, path)
  const { record } = report
  if (record.status === 'submitted') return { message: `${label(record)} is already submitted`, path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${statusLabel(record)} and can no longer be submitted.`)
  if (!String(record.employeeName ?? '').trim()) fail('Enter the employee\'s name before submitting.')
  if (!datePattern.test(record.date ?? '')) fail('Enter the report date before submitting.')
  const ledger = await ledgerSettings(files)
  const total = reportTotal(record.lines, ledger.minorDigits)
  Object.assign(record, { status: 'submitted', submittedAt: now, total: formatMinor(total, ledger.minorDigits), updatedAt: now })
  await saveRecord(files, report, expenses.mime('report'))
  return { message: `Submitted ${label(record)} (${record.total}) for approval`, path }
}

export async function approveReport(files, path, { approver, now }) {
  const report = await readReport(files, path)
  const { record } = report
  if (record.status === 'approved' || record.status === 'posted') {
    return { message: `${label(record)} is already approved`, path }
  }
  if (record.status !== 'submitted') fail(`${label(record)} is ${statusLabel(record)}. Submit it before approving.`)
  const name = String(approver ?? '').trim()
  if (!name) fail('Enter the approver\'s name.')
  Object.assign(record, { status: 'approved', approver: name, approvedAt: now, updatedAt: now })
  await saveRecord(files, report, expenses.mime('report'))
  return { message: `Approved ${label(record)}`, path }
}

export async function refuseReport(files, path, { reason, now }) {
  const report = await readReport(files, path)
  const { record } = report
  if (record.status === 'refused') return { message: `${label(record)} is already refused`, path }
  if (record.status !== 'submitted') fail(`${label(record)} is ${statusLabel(record)}. Only submitted reports can be refused.`)
  if (!reason) fail('Give the reason the report is refused.')
  Object.assign(record, { status: 'refused', refusalReason: reason, refusedAt: now, updatedAt: now })
  await saveRecord(files, report, expenses.mime('report'))
  return { message: `Refused ${label(record)}`, path }
}

/** The expense account of each line's category, checked to be an active category with an account chosen. */
async function categoryAccounts(files, lines) {
  const accounts = {}
  for (const path of new Set(lines.map(line => line.category))) {
    const { record } = await readRecord(files, checkPath(path, expenses.categories), 'category')
    if (record.state === 'archived') fail(`Category ${record.name || nameOf(path)} is archived.`)
    if (!record.expenseAccount) fail(`Choose the expense account of category ${record.name || nameOf(path)} first.`)
    accounts[path] = { account: record.expenseAccount, name: record.name || nameOf(path) }
  }
  return accounts
}

export async function postReport(files, path, { now, journal }) {
  const report = await readReport(files, path)
  const { record } = report
  if (record.status === 'posted') return { message: `${label(record)} is already posted`, path: record.journal?.path ?? path }
  if (record.status !== 'approved') fail(`${label(record)} is ${statusLabel(record)}. Approve it before posting.`)
  const ledger = await ledgerSettings(files)
  const digits = ledger.minorDigits
  const config = await readSettings(files, expenses.settingsPath, 'Expenses')
  if (!config.reimbursementAccount) fail('Choose the reimbursement account in Expenses settings first.')
  const total = reportTotal(record.lines, digits)
  const categories = await categoryAccounts(files, record.lines)
  const memo = `${record.code} · ${String(record.employeeName ?? '').trim()}`
  // One debit per expense account, in the order lines first use it; one credit for the reimbursement.
  const debits = new Map()
  for (const line of record.lines) {
    const { account } = categories[line.category]
    debits.set(account, (debits.get(account) ?? 0n) + toMinor(line.amount, digits))
  }
  const lines = [
    ...[...debits.entries()].map(([account, amount]) => journalLine(account, 'debit', amount, digits, memo)),
    journalLine(config.reimbursementAccount, 'credit', total, digits, memo),
  ]
  await readAccounts(files, lines.map(item => item.account))
  await openPeriodFor(files, record.date)
  // Accounting posts the journal through its API (this script asks it; see `handOvers`); `complete-report` then marks the report posted.
  if (!journal) return { message: `Posting ${label(record)} to the ledger`, journalRequest: journalRequest(path, record.date, `Expense report ${memo}`, ledger.baseCurrency, lines) }
  const journalPath = await postedJournalFor(files, path, journal)
  Object.assign(record, {
    total: formatMinor(total, digits), status: 'posted', postedAt: now, journal: { path: journalPath }, updatedAt: now,
  })
  await saveRecord(files, report, expenses.mime('report'))
  return { message: `Posted ${label(record)} (${record.total})`, path: journalPath }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, approver, reason } = parameters ?? {}
  const options = {
    now,
    approver: typeof approver === 'string' ? approver.trim().slice(0, 200) : '',
    reason: typeof reason === 'string' ? reason.trim().slice(0, 1000) : '',
  }
  if (operation === 'submit-report') return submitReport(files, path, options)
  if (operation === 'approve-report') return approveReport(files, path, options)
  if (operation === 'refuse-report') return refuseReport(files, path, options)
  if (operation === 'post-report') return postReport(files, path, options)
  if (operation === 'complete-report') return postReport(files, path, { ...options, journal: parameters.journal })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

/**
 * Operations that hand a request to another app: the script calls that app's API operation itself
 * (`engine.apps.call`, as the same user under the other app's consent) and records the result, in the same run.
 */
export const handOvers = {
  'post-report': { app: 'accounting', operation: 'post-journal', field: 'journalRequest', recordOperation: 'complete-report', parameter: 'journal', key: 'journal', required: true, label: 'Accounting' },
}
export const runWithApps = withAppCalls(run, handOvers)

export default async function post(engine) {
  await engine.output.result(await runWithApps(engine.context.input.parameters, engine.files, engine.apps))
}
