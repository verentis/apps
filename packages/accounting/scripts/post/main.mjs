// Posts and reverses Accounting journals and expenses. Canvas forms run this script (run-script) against a saved
// record; it validates the ledger rules the files themselves cannot enforce, then writes with the file access its
// installer consented to (manifest `file-access`).
//
// Integrity model: derived journals get deterministic names (`/journals/EXP-0001`, `<journal>-R`) and are created
// create-only, so a retried operation never posts twice; source records are updated conditionally (If-Match), so
// a concurrent edit fails instead of being overwritten. The steps are not one transaction: if a run stops between
// writing a journal and updating its source, running the same operation again completes it.
import { randomUUID } from 'node:crypto'
import {
  accounting, balanceLines, createJournal, fail, formatMinor, journalLine, ledgerSettings, nameOf, nowIso, openPeriodFor,
  postedJournal, readAccounts, readRecord, reverseJournal, saveRecord, toMinor,
} from './ledger.mjs'

export const operations = ['post-journal', 'reverse-journal', 'post-expense', 'reverse-expense']
const expenses = '/expenses'

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

function checkCurrency(record, ledger) {
  const currency = record.currency || ledger.baseCurrency
  if (currency !== ledger.baseCurrency) fail(`The ledger is kept in ${ledger.baseCurrency}; ${record.code || 'this record'} is in ${currency}.`)
  return currency
}

const label = record => record.code || 'This record'
const dateOr = (value, now) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : now.slice(0, 10))

export async function postJournal(files, path, { now }) {
  const journal = await readRecord(files, checkPath(path, accounting.journals), 'journal')
  const { record } = journal
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before posting.`)
  if (record.status === 'posted') return { message: `${label(record)} is already posted`, path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${record.status}.`)
  if (!String(record.description ?? '').trim()) fail('Describe the journal before posting it.')
  const ledger = await ledgerSettings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  balanceLines(record.lines, digits)
  await readAccounts(files, record.lines.map(line => line.account))
  const period = await openPeriodFor(files, record.date)
  record.lines = record.lines.map(line => ({ ...line, amount: formatMinor(toMinor(line.amount, digits), digits) }))
  Object.assign(record, { currency, status: 'posted', postedAt: now, period: { path: period.path }, updatedAt: now })
  await saveRecord(files, journal, accounting.mime('journal'))
  return { message: `Posted ${label(record)}`, path }
}

export async function reverseManualJournal(files, path, { date, reason, now, uuid }) {
  const { record } = await readRecord(files, checkPath(path, accounting.journals), 'journal')
  if (record.source) fail(`${label(record)} was posted from ${record.source.path}. Reverse it from there.`)
  if (record.reversedBy) return { message: `${label(record)} is already reversed by ${nameOf(record.reversedBy.path)}`, path: record.reversedBy.path }
  if (record.status !== 'posted') fail(`${label(record)} is not posted.`)
  const reversal = await reverseJournal(files, path, { date: dateOr(date, now), reason, now, uuid })
  return { message: `Reversed ${label(record)} with ${nameOf(reversal)}`, path: reversal }
}

/** The balanced journal lines of an expense: expense and recoverable tax debited, the paying account credited. */
export function expenseLines(record, ledger) {
  const digits = ledger.minorDigits
  const net = toMinor(record.netAmount, digits, 'Net amount')
  const tax = toMinor(record.taxAmount || '0', digits, 'Tax amount')
  if (net <= 0n) fail('Enter a positive net amount before posting.')
  if (tax < 0n) fail('The tax amount cannot be negative.')
  const gross = net + tax
  let taxAccount
  if (tax > 0n) {
    if (!record.taxCode) fail('Choose the tax code the tax amount is recovered under.')
    const taxCode = (ledger.taxCodes ?? []).find(candidate => candidate.code === record.taxCode)
    if (!taxCode) fail(`Tax code ${record.taxCode} is not defined in Accounting settings.`)
    if (!taxCode.account) fail(`Tax code ${record.taxCode} has no tax account in Accounting settings.`)
    taxAccount = taxCode.account
  }
  if (!record.expenseAccount) fail('Choose the expense account.')
  if (!record.paymentAccount) fail('Choose the account the expense was paid from.')
  const memo = record.description
  return {
    net, tax, gross,
    lines: [
      journalLine(record.expenseAccount, 'debit', net, digits, memo),
      ...(taxAccount ? [journalLine(taxAccount, 'debit', tax, digits, `${record.taxCode} on ${memo}`)] : []),
      journalLine(record.paymentAccount, 'credit', gross, digits, memo),
    ],
  }
}

export async function postExpense(files, path, { now, uuid }) {
  const expense = await readRecord(files, checkPath(path, expenses), 'expense')
  const { record } = expense
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before posting.`)
  if (record.status && record.status !== 'draft') return { message: `${label(record)} is already ${record.status}`, path: record.journal?.path ?? path }
  if (!String(record.description ?? '').trim()) fail('Describe the expense before posting it.')
  const ledger = await ledgerSettings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const { net, tax, gross, lines } = expenseLines(record, ledger)
  await readAccounts(files, lines.map(line => line.account))
  const period = await openPeriodFor(files, record.date)
  const journalPath = `${accounting.journals}/${nameOf(path)}`
  const description = [record.description, record.payee].filter(Boolean).join(' · ')
  await createJournal(files, journalPath, postedJournal({
    code: nameOf(journalPath), date: record.date, description, currency, period: period.path, lines, source: path, now, id: uuid(),
  }), 'source')
  Object.assign(record, {
    currency, netAmount: formatMinor(net, digits), taxAmount: formatMinor(tax, digits), grossAmount: formatMinor(gross, digits),
    status: 'posted', journal: { path: journalPath }, postedAt: now, updatedAt: now,
  })
  await saveRecord(files, expense, accounting.mime('expense'))
  return { message: `Posted ${label(record)} as ${nameOf(journalPath)}`, path: journalPath }
}

export async function reverseExpense(files, path, { date, reason, now, uuid }) {
  const expense = await readRecord(files, checkPath(path, expenses), 'expense')
  const { record } = expense
  if (record.status === 'reversed') return { message: `${label(record)} is already reversed`, path: record.reversalJournal?.path ?? path }
  if (record.status !== 'posted' || !record.journal?.path) fail(`${label(record)} is not posted.`)
  const reversal = await reverseJournal(files, record.journal.path, { date: dateOr(date, now), reason, now, uuid })
  Object.assign(record, { status: 'reversed', reversalJournal: { path: reversal }, reversedAt: now, updatedAt: now })
  await saveRecord(files, expense, accounting.mime('expense'))
  return { message: `Reversed ${label(record)} with ${nameOf(reversal)}`, path: reversal }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path, date, reason } = parameters ?? {}
  const options = { now, uuid, date, reason: typeof reason === 'string' ? reason.trim().slice(0, 500) : '' }
  if (operation === 'post-journal') return postJournal(files, path, options)
  if (operation === 'reverse-journal') return reverseManualJournal(files, path, options)
  if (operation === 'post-expense') return postExpense(files, path, options)
  if (operation === 'reverse-expense') return reverseExpense(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
