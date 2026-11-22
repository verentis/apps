// Issues Invoicing invoices and credit notes and posts payments to the Accounting ledger. Canvas forms run this
// script (run-script) against a saved record; it computes the totals, validates against the ledger, writes the
// journal and a document copy, then marks the record issued or posted with the file access its installer consented
// to (manifest `file-access`).
//
// Integrity model: journals get deterministic names (`/journals/INV-0001`, `<journal>-R`) and are created
// create-only, so a retried operation never posts twice; records are updated conditionally (If-Match), so a
// concurrent edit fails instead of being overwritten. The steps are not one transaction: if a run stops between
// writing the journal and updating the record, running the same operation again completes it.
import { randomUUID } from 'node:crypto'
import {
  accounting, createJournal, divideHalfUp, fail, formatMinor, journalLine, ledgerSettings, nameOf, nowIso, openPeriodFor,
  parseDecimal, postedJournal, readAccounts, readFolder, readRecord, readSettings, reverseJournal, saveRecord, toMinor,
} from './ledger.mjs'

export const operations = ['issue-invoice', 'issue-credit', 'post-payment', 'reverse-payment']
export const invoicing = {
  settingsPath: '/settings/invoicing.json',
  invoices: '/invoices',
  credits: '/credit-notes',
  payments: '/payments',
  mime: kind => `application/vnd.verentis.invoicing.${kind}+json`,
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This record'

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

function checkCurrency(record, ledger) {
  const currency = record.currency || ledger.baseCurrency
  if (currency !== ledger.baseCurrency) fail(`The ledger is kept in ${ledger.baseCurrency}; ${label(record)} is in ${currency}.`)
  return currency
}

async function settings(files) {
  const values = await readSettings(files, invoicing.settingsPath, 'Invoicing')
  for (const key of ['receivableAccount', 'incomeAccount', 'taxAccount']) {
    if (!values[key]) fail(`Choose the ${key.replace(/Account$/, '')} account in Invoicing settings first.`)
  }
  return values
}

/**
 * Exact line and document totals in minor units. Each line's net (quantity × unit price) and tax (net × rate) are
 * rounded half up to the currency's minor unit; the document totals are the sums of the rounded lines.
 */
export function lineTotals(lines, digits, defaultTaxRate = '0') {
  if (!Array.isArray(lines) || lines.length === 0) fail('Add at least one line.')
  let net = 0n
  let tax = 0n
  const normalised = lines.map((item, index) => {
    const at = `Line ${index + 1}`
    if (!String(item.description ?? '').trim()) fail(`${at} needs a description.`)
    const quantity = parseDecimal(item.quantity, `${at} quantity`, 6)
    const price = toMinor(item.unitPrice, digits, `${at} unit price`)
    const rateText = String(item.taxRate === '' || item.taxRate === undefined ? defaultTaxRate ?? '0' : item.taxRate).trim()
    const rate = parseDecimal(rateText, `${at} tax rate`, 4)
    const lineNet = divideHalfUp(quantity.units * price, 10n ** BigInt(quantity.scale))
    const lineTax = divideHalfUp(lineNet * rate.units, 100n * 10n ** BigInt(rate.scale))
    net += lineNet
    tax += lineTax
    return { ...item, description: item.description.trim(), unitPrice: formatMinor(price, digits), taxRate: rateText }
  })
  if (net + tax === 0n) fail('The total is zero.')
  return { lines: normalised, net, tax, gross: net + tax }
}

const formatTotals = ({ net, tax, gross }, digits) => ({ net: formatMinor(net, digits), tax: formatMinor(tax, digits), gross: formatMinor(gross, digits) })

/** What remains to be paid on an issued invoice: its total less issued credit notes and posted payment allocations. */
export async function outstanding(files, invoicePath, digits, { exceptCredit, exceptPayment } = {}) {
  const invoice = await readRecord(files, checkPath(invoicePath, invoicing.invoices), 'invoice')
  if (invoice.record.status !== 'issued') fail(`${label(invoice.record)} has not been issued.`)
  let remaining = toMinor(invoice.record.totals.gross, digits)
  for (const { path, record } of await readFolder(files, invoicing.credits, invoicing.mime('credit'), 'credit')) {
    if (path !== exceptCredit && record.status === 'issued' && record.invoice === invoicePath) remaining -= toMinor(record.totals.gross, digits)
  }
  for (const { path, record } of await readFolder(files, invoicing.payments, invoicing.mime('payment'), 'payment')) {
    if (path === exceptPayment || record.status !== 'posted') continue
    for (const allocation of record.allocations ?? []) if (allocation.invoice === invoicePath) remaining -= toMinor(allocation.amount, digits)
  }
  return { invoice, remaining }
}

const partyLines = party => [
  party?.legalName || party?.name,
  party?.name && party?.legalName && party.name !== party.legalName ? party.name : '',
  ...(party?.address?.lines ?? []),
  [party?.address?.postalCode, party?.address?.city].filter(Boolean).join(' '),
  party?.address?.region, party?.address?.country,
  party?.taxIdentifier ? `Tax ID ${party.taxIdentifier}` : '', party?.email, party?.phone,
].filter(Boolean)

const cell = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** A readable Markdown copy of an issued invoice or credit note, stored beneath it. */
export function documentMarkdown(title, record, seller, customer, details) {
  const { currency } = record
  return [
    `# ${title} ${record.code}`,
    '',
    details,
    '',
    '| From | To |',
    '| --- | --- |',
    `| ${partyLines(seller).map(cell).join('<br>')} | ${partyLines(customer).map(cell).join('<br>')} |`,
    '',
    `| Description | Quantity | Unit price (${currency}) | Tax % |`,
    '| --- | ---: | ---: | ---: |',
    ...record.lines.map(item => `| ${cell(item.description)} | ${item.quantity} | ${item.unitPrice} | ${item.taxRate} |`),
    '',
    `| | ${currency} |`,
    '| --- | ---: |',
    `| Net | ${record.totals.net} |`,
    `| Tax | ${record.totals.tax} |`,
    `| **Total** | **${record.totals.gross}** |`,
    '',
    ...(record.notes ? [record.notes, ''] : []),
  ].join('\n')
}

async function writeDocument(files, recordPath, code, markdown) {
  const path = `${recordPath}/documents/${code}.md`
  await files.write(path, markdown, { contentType: 'text/markdown' })
  return path
}

export async function issueInvoice(files, path, { now, uuid }) {
  const invoice = await readRecord(files, checkPath(path, invoicing.invoices), 'invoice')
  const { record } = invoice
  checkActive(record)
  if (record.status === 'issued') return { message: `${label(record)} is already issued`, path: record.document?.path ?? path }
  if (!String(record.customer?.name ?? '').trim()) fail('Enter the customer\'s name before issuing.')
  if (!datePattern.test(record.issueDate ?? '')) fail('Enter the issue date before issuing.')
  if (!datePattern.test(record.dueDate ?? '') || record.dueDate < record.issueDate) fail('The due date must be on or after the issue date.')
  const ledger = await ledgerSettings(files)
  const config = await settings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const totals = lineTotals(record.lines, digits, config.defaultTaxRate)
  const memo = `${record.code} · ${record.customer.name.trim()}`
  const lines = [
    journalLine(config.receivableAccount, 'debit', totals.gross, digits, memo),
    ...(totals.net ? [journalLine(config.incomeAccount, 'credit', totals.net, digits, memo)] : []),
    ...(totals.tax ? [journalLine(config.taxAccount, 'credit', totals.tax, digits, memo)] : []),
  ]
  await readAccounts(files, lines.map(item => item.account))
  const period = await openPeriodFor(files, record.issueDate)
  const journalPath = `${accounting.journals}/${nameOf(path)}`
  await createJournal(files, journalPath, postedJournal({
    code: nameOf(journalPath), date: record.issueDate, description: `Invoice ${memo}`, currency, period: period.path, lines, source: path, now, id: uuid(),
  }), 'source')
  Object.assign(record, { currency, seller: config.seller ?? {}, lines: totals.lines, totals: formatTotals(totals, digits) })
  const document = await writeDocument(files, path, record.code, documentMarkdown('Invoice', record, record.seller, record.customer,
    `Issued ${record.issueDate} · Due ${record.dueDate}${record.reference ? ` · Reference ${record.reference}` : ''}`))
  Object.assign(record, { status: 'issued', issuedAt: now, journal: { path: journalPath }, document: { path: document }, updatedAt: now })
  await saveRecord(files, invoice, invoicing.mime('invoice'))
  return { message: `Issued ${label(record)}`, path: document }
}

export async function issueCredit(files, path, { now, uuid }) {
  const credit = await readRecord(files, checkPath(path, invoicing.credits), 'credit')
  const { record } = credit
  checkActive(record)
  if (record.status === 'issued') return { message: `${label(record)} is already issued`, path: record.document?.path ?? path }
  if (!datePattern.test(record.date ?? '')) fail('Enter the credit note date before issuing.')
  if (!String(record.reason ?? '').trim()) fail('Give the reason for the credit before issuing.')
  if (!record.invoice) fail('Choose the invoice this credit note is against.')
  const ledger = await ledgerSettings(files)
  const config = await settings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const { invoice, remaining } = await outstanding(files, record.invoice, digits, { exceptCredit: path })
  if (invoice.record.currency !== currency) fail(`${label(invoice.record)} is in ${invoice.record.currency}, not ${currency}.`)
  const totals = lineTotals(record.lines, digits, config.defaultTaxRate)
  if (totals.gross > remaining) {
    fail(`The credit (${formatMinor(totals.gross, digits)}) is more than ${label(invoice.record)} has outstanding (${formatMinor(remaining, digits)}).`)
  }
  const customer = invoice.record.customer
  const memo = [record.code, customer?.name, invoice.record.code].filter(Boolean).join(' · ')
  const lines = [
    ...(totals.net ? [journalLine(config.incomeAccount, 'debit', totals.net, digits, memo)] : []),
    ...(totals.tax ? [journalLine(config.taxAccount, 'debit', totals.tax, digits, memo)] : []),
    journalLine(config.receivableAccount, 'credit', totals.gross, digits, memo),
  ]
  await readAccounts(files, lines.map(item => item.account))
  const period = await openPeriodFor(files, record.date)
  const journalPath = `${accounting.journals}/${nameOf(path)}`
  await createJournal(files, journalPath, postedJournal({
    code: nameOf(journalPath), date: record.date, description: `Credit note ${memo}`, currency, period: period.path, lines, source: path, now, id: uuid(),
  }), 'source')
  Object.assign(record, { currency, customer, lines: totals.lines, totals: formatTotals(totals, digits) })
  const document = await writeDocument(files, path, record.code, documentMarkdown('Credit note', record, invoice.record.seller, customer,
    `Issued ${record.date} · Against invoice ${invoice.record.code} · ${record.reason.trim()}`))
  Object.assign(record, { status: 'issued', issuedAt: now, journal: { path: journalPath }, document: { path: document }, updatedAt: now })
  await saveRecord(files, credit, invoicing.mime('credit'))
  return { message: `Issued ${label(record)} against ${label(invoice.record)}`, path: document }
}

export async function postPayment(files, path, { now, uuid }) {
  const payment = await readRecord(files, checkPath(path, invoicing.payments), 'payment')
  const { record } = payment
  checkActive(record)
  if (record.status && record.status !== 'draft') return { message: `${label(record)} is already ${record.status}`, path: record.journal?.path ?? path }
  if (!datePattern.test(record.date ?? '')) fail('Enter the payment date before posting.')
  if (!record.bankAccount) fail('Choose the account the payment was received into.')
  const ledger = await ledgerSettings(files)
  const config = await settings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const amount = toMinor(record.amount, digits, 'Amount')
  if (amount === 0n) fail('Enter the amount received.')
  let allocated = 0n
  const allocations = []
  for (const [index, allocation] of (record.allocations ?? []).entries()) {
    const value = toMinor(allocation.amount, digits, `Allocation ${index + 1} amount`)
    if (value === 0n) continue
    if (allocations.some(existing => existing.invoice === allocation.invoice)) fail(`${nameOf(allocation.invoice ?? '')} is allocated twice.`)
    const { invoice, remaining } = await outstanding(files, allocation.invoice, digits, { exceptPayment: path })
    if (value > remaining) fail(`${label(invoice.record)} has ${formatMinor(remaining, digits)} outstanding, less than the ${formatMinor(value, digits)} allocated to it.`)
    allocated += value
    allocations.push({ invoice: allocation.invoice, amount: formatMinor(value, digits) })
  }
  if (allocated > amount) fail(`The allocations (${formatMinor(allocated, digits)}) are more than the payment (${formatMinor(amount, digits)}).`)
  const memo = [record.code, record.payer, record.reference].filter(Boolean).join(' · ')
  const lines = [
    journalLine(record.bankAccount, 'debit', amount, digits, memo),
    journalLine(config.receivableAccount, 'credit', amount, digits, memo),
  ]
  await readAccounts(files, lines.map(item => item.account))
  const period = await openPeriodFor(files, record.date)
  const journalPath = `${accounting.journals}/${nameOf(path)}`
  await createJournal(files, journalPath, postedJournal({
    code: nameOf(journalPath), date: record.date, description: `Payment ${memo}`, currency, period: period.path, lines, source: path, now, id: uuid(),
  }), 'source')
  Object.assign(record, {
    currency, amount: formatMinor(amount, digits), allocations, status: 'posted', postedAt: now, journal: { path: journalPath }, updatedAt: now,
  })
  await saveRecord(files, payment, invoicing.mime('payment'))
  const unallocated = amount - allocated
  return { message: `Posted ${label(record)}${unallocated ? ` (${formatMinor(unallocated, digits)} unallocated)` : ''}`, path: journalPath }
}

export async function reversePayment(files, path, { date, reason, now, uuid }) {
  const payment = await readRecord(files, checkPath(path, invoicing.payments), 'payment')
  const { record } = payment
  if (record.status === 'reversed') return { message: `${label(record)} is already reversed`, path: record.reversalJournal?.path ?? path }
  if (record.status !== 'posted' || !record.journal?.path) fail(`${label(record)} is not posted.`)
  const reversal = await reverseJournal(files, record.journal.path, { date: datePattern.test(date ?? '') ? date : now.slice(0, 10), reason, now, uuid })
  Object.assign(record, { status: 'reversed', reversalJournal: { path: reversal }, reversedAt: now, updatedAt: now })
  await saveRecord(files, payment, invoicing.mime('payment'))
  return { message: `Reversed ${label(record)} with ${nameOf(reversal)}`, path: reversal }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path, date, reason } = parameters ?? {}
  const options = { now, uuid, date, reason: typeof reason === 'string' ? reason.trim().slice(0, 500) : '' }
  if (operation === 'issue-invoice') return issueInvoice(files, path, options)
  if (operation === 'issue-credit') return issueCredit(files, path, options)
  if (operation === 'post-payment') return postPayment(files, path, options)
  if (operation === 'reverse-payment') return reversePayment(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
