// Confirms Sales quotations. The quotation form runs this script (run-script) against a saved record; it
// validates the quotation, computes its exact totals, creates the sales order it becomes and marks the quotation
// confirmed with the file access its installer consented to (manifest `file-access`). It returns what Invoicing needs
// to draft the invoice; the form asks Invoicing through the platform (Invoicing's `create-draft-invoice`), and
// `record-invoice` stores the link. Sales never writes Invoicing's files.
//
// Integrity model: the sales order gets a deterministic name (`/sales-orders/QUO-0001`) and is created create-only,
// so a retried operation never creates twice; Invoicing returns the same draft when asked again; the quotation is
// updated conditionally (If-Match), so a concurrent edit fails instead of being overwritten. The steps are not one
// transaction: if a run stops between writing the order and updating the quotation, running confirm again
// completes it.
import { randomUUID } from 'node:crypto'
import {
  divideHalfUp, fail, formatMinor, nameOf, nowIso, parseDecimal, readRecord, readSettings, saveRecord, statusOf, toMinor,
} from './ledger.mjs'

export const operations = ['confirm-quotation', 'record-invoice']
export const sales = {
  settingsPath: '/settings/sales.json',
  products: '/products',
  quotations: '/quotations',
  orders: '/sales-orders',
  mime: kind => `application/vnd.verentis.sales.${kind}+json`,
  schema: kind => `https://schemas.verentis.io/sales/v1/${kind}.schema.json`,
}
/** Quotations are kept in the currency's minor unit; two digits covers the supported currencies. */
export const digits = 2
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This quotation'

/**
 * Exact line and quotation totals in minor units. Each line's net (quantity × unit price) and discount
 * (net × discount %) are rounded half up to the cent; the quotation totals are the sums of the rounded lines.
 */
export function quoteTotals(lines) {
  if (!Array.isArray(lines) || lines.length === 0) fail('Add at least one line.')
  let subtotal = 0n
  let discountTotal = 0n
  const nets = []
  const normalised = lines.map((item, index) => {
    const at = `Line ${index + 1}`
    if (!String(item.description ?? '').trim()) fail(`${at} needs a description.`)
    const quantity = parseDecimal(item.quantity, `${at} quantity`, 6)
    if (quantity.units === 0n) fail(`${at} has no quantity.`)
    const price = toMinor(item.unitPrice, digits, `${at} unit price`)
    const rateText = String(item.discount === '' || item.discount === undefined || item.discount === null ? '0' : item.discount).trim()
    const rate = parseDecimal(rateText, `${at} discount`, 4)
    if (rate.units > 100n * 10n ** BigInt(rate.scale)) fail(`${at} discount cannot exceed 100%.`)
    const net = divideHalfUp(quantity.units * price, 10n ** BigInt(quantity.scale))
    const discount = divideHalfUp(net * rate.units, 100n * 10n ** BigInt(rate.scale))
    subtotal += net
    discountTotal += discount
    nets.push(net - discount)
    return { product: item.product ?? '', description: item.description.trim(), quantity: item.quantity, unitPrice: formatMinor(price, digits), discount: rateText }
  })
  const total = subtotal - discountTotal
  if (total === 0n) fail('The total is zero.')
  return { lines: normalised, nets, subtotal, discount: discountTotal, total }
}

/** Every product a line quotes must exist in /products, be a product and be active. Empty references are fine. */
async function checkProducts(files, lines) {
  for (const [index, line] of lines.entries()) {
    const path = line.product ?? ''
    if (path === '') continue
    if (typeof path !== 'string' || !path.startsWith(`${sales.products}/`) || path.slice(sales.products.length + 1).includes('/')) {
      fail(`Line ${index + 1} must quote a product from ${sales.products} (got ${JSON.stringify(path)}).`)
    }
    let product
    try {
      product = await files.readJson(path)
    } catch (error) {
      if (statusOf(error) === 404) fail(`Line ${index + 1} quotes ${path}, which does not exist.`)
      if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
      throw error
    }
    if (product?.kind !== 'product') fail(`${path} is not a product.`)
    if (product.state === 'archived') fail(`Product ${product.code || path} is archived.`)
  }
}

/**
 * Creates the sales order create-only under its deterministic name. If an earlier, interrupted attempt already
 * wrote it (same quotation and lines), the existing order is kept: retrying never creates twice.
 */
async function createOrder(files, path, order) {
  try {
    await files.write(path, JSON.stringify(order, null, 2), { contentType: sales.mime('order'), ifNoneMatch: '*' })
    return
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  let existing
  try {
    existing = await files.readJson(path)
  } catch {
    existing = null
  }
  if (existing?.kind !== 'order' || existing.quotation !== order.quotation) {
    fail(`${path} already exists and belongs to something else. Rename it and try again.`)
  }
  const amounts = lines => JSON.stringify((lines ?? []).map(({ product, quantity, unitPrice, discount }) => [product, quantity, unitPrice, discount]))
  if (amounts(existing.lines) !== amounts(order.lines)) {
    fail(`${path} was created by an earlier attempt with different lines. Check it against ${order.quotation} before trying again.`)
  }
}

/**
 * What Invoicing needs to draft the confirmed quotation's invoice (its `create-draft-invoice` operation): each
 * quotation line becomes one invoice line carrying its discounted net. The quotation form asks Invoicing through the
 * platform; Sales never writes Invoicing's files.
 */
export function invoiceRequest(path, record, nets) {
  return {
    source: { path, code: record.code },
    currency: record.currency,
    reference: record.reference || record.code,
    ...(record.customerRef ? { customerRef: record.customerRef } : {}),
    customer: record.customer ?? {},
    lines: record.lines.map((line, index) => ({
      description: `${line.quantity} × ${line.description}${Number(line.discount) ? ` (${line.discount}% discount)` : ''}`,
      quantity: '1', unitPrice: formatMinor(nets[index], digits),
    })),
    notes: `Drafted from quotation ${record.code}.`,
  }
}

/** Records the invoice Invoicing drafted for a confirmed quotation (the path its operation returned). */
export async function recordInvoice(files, path, invoicePath, { now }) {
  const quotation = await readRecord(files, checkPath(path, sales.quotations), 'quotation')
  const { record } = quotation
  if (record.status !== 'confirmed') fail(`${label(record)} is not confirmed.`)
  if (typeof invoicePath !== 'string' || !invoicePath.startsWith('/invoices/')) fail('Invoicing returned no invoice.')
  if (record.invoice?.path === invoicePath) return { message: `${label(record)} already links ${nameOf(invoicePath)}`, path }
  Object.assign(record, { invoice: { path: invoicePath }, updatedAt: now })
  await saveRecord(files, quotation, sales.mime('quotation'))
  return { message: `Drafted invoice ${nameOf(invoicePath)} for ${label(record)}`, path }
}

export async function confirmQuotation(files, path, { now, uuid }) {
  const quotation = await readRecord(files, checkPath(path, sales.quotations), 'quotation')
  const { record } = quotation
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  if (record.status === 'confirmed') {
    return { message: `${label(record)} is already confirmed`, path: record.order?.path ?? path,
      // Confirmed without an invoice yet (Invoicing was missing or the draft failed): ask again.
      ...(record.invoice?.path ? {} : { invoiceRequest: invoiceRequest(path, record, quoteTotals(record.lines).nets) }) }
  }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled. Reopen it first.`)
  if (!codePattern.test(record.code ?? '')) fail('The quotation has no number. Create quotations with New so they are numbered.')
  if (!String(record.customer?.name ?? '').trim()) fail('Enter the customer\'s name before confirming.')
  if (!datePattern.test(record.date ?? '')) fail('Enter the quotation date before confirming.')
  const settings = await readSettings(files, sales.settingsPath, 'Sales')
  const currency = record.currency || settings.currency || ''
  if (!/^[A-Z]{3}$/.test(currency)) fail('Enter the currency (e.g. ZAR) before confirming.')
  const totals = quoteTotals(record.lines)
  await checkProducts(files, totals.lines)
  const formatted = {
    subtotal: formatMinor(totals.subtotal, digits),
    discount: formatMinor(totals.discount, digits),
    total: formatMinor(totals.total, digits),
  }
  const orderPath = `${sales.orders}/${record.code}`
  await createOrder(files, orderPath, {
    $schema: sales.schema('order'), schemaVersion: 1, kind: 'order', id: uuid(), state: 'active',
    createdAt: now, updatedAt: now, code: record.code, date: now.slice(0, 10), currency,
    customer: record.customer ?? {}, quotation: path, lines: totals.lines, totals: formatted,
    deliveryStatus: 'pending', notes: record.notes ?? '',
  })
  Object.assign(record, { currency, lines: totals.lines, totals: formatted })
  Object.assign(record, { status: 'confirmed', confirmedAt: now, order: { path: orderPath }, updatedAt: now })
  await saveRecord(files, quotation, sales.mime('quotation'))
  // The form asks Invoicing (when installed) to draft the invoice from this, then records the link.
  return { message: `Confirmed ${label(record)} into ${nameOf(orderPath)}`, path: orderPath, invoiceRequest: invoiceRequest(path, record, totals.nets) }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'confirm-quotation') return confirmQuotation(files, path, { now, uuid })
  if (operation === 'record-invoice') return recordInvoice(files, path, parameters.invoice, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
