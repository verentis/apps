// Confirms Sales quotations. The quotation form runs this script (run-script) against a saved record; it
// validates the quotation, computes its exact totals, creates the sales order it becomes and, when Invoicing is
// installed, drafts an invoice in Invoicing's vendor format, then marks the quotation confirmed with the file
// access its installer consented to (manifest `file-access`).
//
// Integrity model: the sales order and the draft invoice get deterministic names (`/sales-orders/QUO-0001`,
// `/invoices/QUO-0001`) and are created create-only, so a retried operation never creates twice; the quotation is
// updated conditionally (If-Match), so a concurrent edit fails instead of being overwritten. The steps are not one
// transaction: if a run stops between writing the order and updating the quotation, running confirm again
// completes it.
import { randomUUID } from 'node:crypto'
import {
  divideHalfUp, fail, formatMinor, nameOf, nowIso, parseDecimal, readRecord, readSettings, saveRecord, statusOf, toMinor,
} from './ledger.mjs'

export const operations = ['confirm-quotation']
export const sales = {
  settingsPath: '/settings/sales.json',
  products: '/products',
  quotations: '/quotations',
  orders: '/sales-orders',
  mime: kind => `application/vnd.verentis.sales.${kind}+json`,
  schema: kind => `https://schemas.verentis.io/sales/v1/${kind}.schema.json`,
}
/** Invoicing's public file contract: present only when Invoicing is installed. */
export const invoicing = {
  invoices: '/invoices',
  mime: 'application/vnd.verentis.invoicing.invoice+json',
  schema: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
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
 * Drafts an Invoicing invoice for the confirmed quotation when Invoicing is installed (its /invoices container
 * exists). Each quotation line becomes one invoice line carrying its discounted net. Absent Invoicing, missing
 * write access and an invoice drafted by an earlier attempt are all tolerated.
 */
async function draftInvoice(files, record, nets, { now, uuid }) {
  if (!await files.stat(invoicing.invoices)) return null
  const path = `${invoicing.invoices}/${record.code}`
  const lines = record.lines.map((line, index) => ({
    description: `${line.quantity} × ${line.description}${Number(line.discount) ? ` (${line.discount}% discount)` : ''}`,
    quantity: '1', unitPrice: formatMinor(nets[index], digits), taxRate: '',
  }))
  const invoice = {
    $schema: invoicing.schema, schemaVersion: 1, kind: 'invoice', id: uuid(), state: 'active',
    createdAt: now, updatedAt: now, code: record.code, issueDate: '', dueDate: '', currency: record.currency,
    reference: record.reference || record.code, customerRef: record.customerRef || '', customer: record.customer ?? {},
    lines, notes: `Drafted from quotation ${record.code}.`, status: 'draft',
  }
  try {
    await files.write(path, JSON.stringify(invoice, null, 2), { contentType: invoicing.mime, ifNoneMatch: '*' })
  } catch (error) {
    const status = statusOf(error)
    if (status === 403 || status === 404) return null
    if (status !== 412) throw error
    let existing
    try {
      existing = await files.readJson(path)
    } catch {
      existing = null
    }
    if (existing?.kind !== 'invoice' || existing.code !== record.code) {
      fail(`${path} already exists and belongs to something else. Rename it and try again.`)
    }
  }
  return path
}

export async function confirmQuotation(files, path, { now, uuid }) {
  const quotation = await readRecord(files, checkPath(path, sales.quotations), 'quotation')
  const { record } = quotation
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  if (record.status === 'confirmed') return { message: `${label(record)} is already confirmed`, path: record.order?.path ?? path }
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
  const invoicePath = await draftInvoice(files, record, totals.nets, { now, uuid })
  Object.assign(record, {
    status: 'confirmed', confirmedAt: now, order: { path: orderPath },
    ...(invoicePath ? { invoice: { path: invoicePath } } : {}), updatedAt: now,
  })
  await saveRecord(files, quotation, sales.mime('quotation'))
  return {
    message: `Confirmed ${label(record)} into ${nameOf(orderPath)}${invoicePath ? ` and drafted invoice ${nameOf(invoicePath)}` : ''}`,
    path: orderPath,
  }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'confirm-quotation') return confirmQuotation(files, path, { now, uuid })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
