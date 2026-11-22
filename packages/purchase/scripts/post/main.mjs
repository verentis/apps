// Confirms and receives Purchase orders. Canvas forms run this script (run-script) against a saved order; it
// validates the lines and the vendor, computes the exact total, then marks the order confirmed or received with
// the file access its installer consented to (manifest `file-access`).
//
// Integrity model: vendor bill drafts get deterministic names (`/invoices/PO-0001-BILL`) and are created
// create-only, so a retried operation never drafts twice; records are updated conditionally (If-Match), so a
// concurrent edit fails instead of being overwritten. The steps are not one transaction: if a run stops between
// drafting the bill and updating the order, running the same operation again completes it.
import { randomUUID } from 'node:crypto'
import {
  divideHalfUp, fail, formatMinor, nameOf, nowIso, parseDecimal, readRecord, saveRecord, statusOf, toMinor,
} from './ledger.mjs'

export const operations = ['confirm-order', 'receive-order']
export const purchase = {
  vendors: '/vendors',
  orders: '/purchase-orders',
  mime: kind => `application/vnd.verentis.purchase.${kind}+json`,
}
/** Invoicing (optional): when its /invoices container exists, receiving drafts a vendor bill into it. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchema: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
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

/** A draft vendor bill in Invoicing's invoice format; `reference` links it back to the purchase order. */
export function draftBill(record, path, { now, id }) {
  return {
    $schema: invoicing.invoiceSchema, schemaVersion: 1, kind: 'invoice', id, state: 'active',
    createdAt: now, updatedAt: now,
    code: `${record.code || nameOf(path)}-BILL`, issueDate: '', dueDate: '',
    currency: record.currency || '', reference: path, customerRef: '',
    customer: {
      name: record.vendorName || '', legalName: '', email: '', phone: '', taxIdentifier: '',
      address: { lines: [], city: '', region: '', postalCode: '', country: '' },
    },
    lines: record.lines.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, taxRate: '' })),
    notes: `Draft vendor bill for purchase order ${record.code || nameOf(path)}.`,
    status: 'draft',
  }
}

/**
 * Drafts the vendor bill create-only under its deterministic name. If an earlier, interrupted attempt already
 * wrote it (its `reference` pointing at the same order), the existing bill is kept: retrying never drafts twice.
 */
async function createBill(files, path, bill) {
  const billPath = `${invoicing.invoices}/${bill.code}`
  try {
    await files.write(billPath, JSON.stringify(bill, null, 2), { contentType: invoicing.invoiceMime, ifNoneMatch: '*' })
    return billPath
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(billPath)
  if (existing?.kind !== 'invoice' || existing.reference !== path) {
    fail(`${billPath} already exists and belongs to something else. Rename it and try again.`)
  }
  return billPath
}

export async function receiveOrder(files, path, { now, uuid }) {
  const order = await readRecord(files, checkPath(path, purchase.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'received') return { message: `${label(record)} is already received`, path: record.bill?.path ?? path }
  if (record.status !== 'confirmed') fail(`${label(record)} is ${record.status || 'draft'}. Confirm it before receiving.`)
  // Invoicing is an optional dependency: the draft vendor bill is only emitted when its container exists.
  const billPath = (await files.stat(invoicing.invoices)) ? await createBill(files, path, draftBill(record, path, { now, id: uuid() })) : null
  Object.assign(record, {
    status: 'received', receivedAt: now, updatedAt: now,
    ...(billPath ? { bill: { path: billPath } } : {}),
  })
  await saveRecord(files, order, purchase.mime('order'))
  return { message: `Received ${label(record)}${billPath ? ` and drafted vendor bill ${nameOf(billPath)}` : ''}`, path: billPath ?? path }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now, uuid }
  if (operation === 'confirm-order') return confirmOrder(files, path, options)
  if (operation === 'receive-order') return receiveOrder(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
