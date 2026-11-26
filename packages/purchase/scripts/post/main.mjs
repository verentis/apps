// Confirms and receives Purchase orders. Canvas forms run this script (run-script) against a saved order; it
// validates the lines and the vendor, computes the exact total, then marks the order confirmed or received with
// the file access its installer consented to (manifest `file-access`).
//
// Receiving returns what Invoicing needs to draft the vendor bill; the script asks Invoicing through the platform
// (Invoicing returns the same draft when asked again) and `record-bill` stores the link. Purchase never writes
// Invoicing's files. Records are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten.
import {
  divideHalfUp, fail, formatMinor, nameOf, nowIso, parseDecimal, readRecord, saveRecord, statusOf, toMinor,
} from './ledger.mjs'
import { withAppCalls } from './app-calls.mjs'

export const operations = ['confirm-order', 'receive-order', 'record-bill']
export const purchase = {
  vendors: '/vendors',
  orders: '/purchase-orders',
  mime: kind => `application/vnd.verentis.purchase.${kind}+json`,
}
/** Purchase orders carry no ledger, so amounts are fixed at two minor digits. */
export const digits = 2
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This order'

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

/**
 * Exact order total in minor units. Each line's amount (quantity × unit price) is rounded half up to the cent;
 * the order total is the sum of the rounded lines.
 */
export function lineTotals(lines) {
  if (!Array.isArray(lines) || lines.length === 0) fail('Add at least one line.')
  let total = 0n
  const normalised = lines.map((item, index) => {
    const at = `Line ${index + 1}`
    if (!String(item.description ?? '').trim()) fail(`${at} needs a description.`)
    const quantity = parseDecimal(item.quantity, `${at} quantity`, 6)
    const price = toMinor(item.unitPrice, digits, `${at} unit price`)
    total += divideHalfUp(quantity.units * price, 10n ** BigInt(quantity.scale))
    return { ...item, description: item.description.trim(), unitPrice: formatMinor(price, digits) }
  })
  if (total === 0n) fail('The total is zero.')
  return { lines: normalised, total }
}

/** The order's vendor record: it must be an active vendor directly in /vendors, with a name to buy under. */
async function readVendor(files, reference) {
  checkPath(reference || '', purchase.vendors)
  let vendor
  try {
    vendor = await files.readJson(reference)
  } catch (error) {
    if (statusOf(error) === 404) fail(`Vendor ${reference} does not exist. Choose a vendor from ${purchase.vendors}.`)
    throw error
  }
  if (vendor?.kind !== 'vendor') fail(`${reference} is not a vendor.`)
  if (vendor.state === 'archived') fail(`Vendor ${vendor.code || reference} is archived. Restore it first.`)
  if (!String(vendor.name ?? '').trim()) fail(`Name the vendor ${vendor.code || reference} before buying from it.`)
  return vendor
}

export async function confirmOrder(files, path, { now }) {
  const order = await readRecord(files, checkPath(path, purchase.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'confirmed' || record.status === 'received') return { message: `${label(record)} is already ${record.status}`, path }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled. Copy its lines into a new order.`)
  if (!datePattern.test(record.orderDate ?? '')) fail('Enter the order date before confirming.')
  if (!datePattern.test(record.expectedDate ?? '') || record.expectedDate < record.orderDate) fail('The expected date must be on or after the order date.')
  const vendor = await readVendor(files, record.vendor)
  const totals = lineTotals(record.lines)
  Object.assign(record, {
    vendorName: vendor.name.trim(), lines: totals.lines, total: formatMinor(totals.total, digits),
    status: 'confirmed', confirmedAt: now, updatedAt: now,
  })
  await saveRecord(files, order, purchase.mime('order'))
  return { message: `Confirmed ${label(record)} · ${[record.currency, record.total].filter(Boolean).join(' ')}`, path }
}

/**
 * What Invoicing needs to draft the received order's vendor bill (its `create-draft-invoice` operation; Invoicing keeps
 * vendor bills as invoices addressed to the vendor). The script asks Invoicing through the platform; Purchase never
 * writes Invoicing's files.
 */
export function billRequest(record, path) {
  return {
    source: { path, code: record.code || nameOf(path) },
    currency: record.currency || '',
    reference: record.code || nameOf(path),
    customer: { name: record.vendorName || '' },
    lines: record.lines.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
    notes: `Draft vendor bill for purchase order ${record.code || nameOf(path)}.`,
  }
}

/** Records the vendor bill Invoicing drafted for a received order (the path its operation returned). */
export async function recordBill(files, path, billPath, { now }) {
  const order = await readRecord(files, checkPath(path, purchase.orders), 'order')
  const { record } = order
  if (record.status !== 'received') fail(`${label(record)} is not received.`)
  if (typeof billPath !== 'string' || !billPath.startsWith('/invoices/')) fail('Invoicing returned no bill.')
  if (record.bill?.path === billPath) return { message: `${label(record)} already links ${nameOf(billPath)}`, path }
  Object.assign(record, { bill: { path: billPath }, updatedAt: now })
  await saveRecord(files, order, purchase.mime('order'))
  return { message: `Drafted vendor bill ${nameOf(billPath)} for ${label(record)}`, path }
}

export async function receiveOrder(files, path, { now }) {
  const order = await readRecord(files, checkPath(path, purchase.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'received') {
    return { message: `${label(record)} is already received`, path: record.bill?.path ?? path, ...(record.bill?.path ? {} : { invoiceRequest: billRequest(record, path) }) }
  }
  if (record.status !== 'confirmed') fail(`${label(record)} is ${record.status || 'draft'}. Confirm it before receiving.`)
  Object.assign(record, { status: 'received', receivedAt: now, updatedAt: now })
  await saveRecord(files, order, purchase.mime('order'))
  // Counted lines that came in short are named in the message, so the buyer can chase the vendor.
  const short = (record.lines ?? []).filter(line => line.received !== undefined && line.received !== '' && Number(line.received) < Number(line.quantity))
  const shortNote = short.length ? `; ${short.length} ${short.length === 1 ? 'line' : 'lines'} short (${short.map(line => `${line.description || 'line'}: ${line.received} of ${line.quantity}`).join(', ')})` : ''
  // The script asks Invoicing (when installed; see `handOvers`) to draft the vendor bill from this, then records the link.
  return { message: `Received ${label(record)}${shortNote}`, path, invoiceRequest: billRequest(record, path) }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'confirm-order') return confirmOrder(files, path, options)
  if (operation === 'receive-order') return receiveOrder(files, path, options)
  if (operation === 'record-bill') return recordBill(files, path, parameters.bill, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

/**
 * Operations that hand a request to another app: the script calls that app's API operation itself
 * (`engine.apps.call`, as the same user under the other app's consent) and records the result, in the same run.
 */
export const handOvers = {
  'receive-order': { app: 'invoicing', operation: 'create-draft-invoice', field: 'invoiceRequest', recordOperation: 'record-bill', parameter: 'bill', key: 'order' },
}
export const runWithApps = withAppCalls(run, handOvers)

export default async function post(engine) {
  await engine.output.result(await runWithApps(engine.context.input.parameters, engine.files, engine.apps))
}
