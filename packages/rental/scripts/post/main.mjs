// Moves Rental bookings through their lifecycle. The booking form runs this script (run-script) against a saved
// record: confirming validates the dates and availability against overlapping bookings and computes the exact
// total; picking up and returning move the units out and back (charging a late fee past the end date); returning
// returns what Invoicing needs to draft the invoice, which the form asks Invoicing for through the platform
// (`record-invoice` stores the link; Rental never writes Invoicing's files); cancelling releases the units.
//
// Integrity model: Invoicing returns the same draft when asked again for the same booking; the booking is updated
// conditionally (If-Match), so a concurrent edit fails instead of being overwritten.
import { fail, formatMinor, nameOf, nowIso, readFolder, readRecord, readSettings, saveRecord, statusOf, toMinor } from './ledger.mjs'

export const operations = ['confirm-booking', 'pickup-booking', 'return-booking', 'cancel-booking', 'record-invoice']
export const rental = {
  settingsPath: '/settings/rental.json',
  products: '/rental-products',
  bookings: '/rental-bookings',
  mime: kind => `application/vnd.verentis.rental.${kind}+json`,
}
/** Invoicing's public file contract: present only when Invoicing is installed. */
/** Amounts are kept in the currency's minor unit; two digits covers the supported currencies. */
export const digits = 2
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This booking'

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

const dayMs = 86_400_000
const toDay = date => Date.parse(`${date}T00:00:00Z`)

/** Whole days between two dates, inclusive of both: a one-day rental starts and ends on the same date. */
export function rentalDays(startDate, endDate) {
  if (!datePattern.test(startDate ?? '')) fail('Enter the start date before confirming.')
  if (!datePattern.test(endDate ?? '')) fail('Enter the end date before confirming.')
  if (endDate < startDate) fail(`The end date (${endDate}) is before the start date (${startDate}).`)
  return Math.round((toDay(endDate) - toDay(startDate)) / dayMs) + 1
}

/** Whole days a return date lies past the booking's end date; on-time and early returns are zero. */
export function lateDays(endDate, returnDate) {
  if (!datePattern.test(returnDate ?? '')) fail(`The return date must be a date (YYYY-MM-DD), got ${JSON.stringify(returnDate ?? '')}.`)
  if (!datePattern.test(endDate ?? '') || returnDate <= endDate) return 0
  return Math.round((toDay(returnDate) - toDay(endDate)) / dayMs)
}

function checkQuantity(value, label_) {
  if (!Number.isInteger(value) || value < 1 || value > 100000) {
    fail(`${label_} must be a whole number of units, at least 1 (got ${JSON.stringify(value ?? '')}).`)
  }
  return value
}

/** The booked product: it must live in /rental-products, be a rental product, be active and be available. */
async function readProduct(files, path) {
  if (typeof path !== 'string' || !path.startsWith(`${rental.products}/`) || path.slice(rental.products.length + 1).includes('/')) {
    fail(`Choose a rental product from ${rental.products} (got ${JSON.stringify(path ?? '')}).`)
  }
  let product
  try {
    product = await files.readJson(path)
  } catch (error) {
    if (statusOf(error) === 404) fail(`${path} does not exist.`)
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (product?.kind !== 'product') fail(`${path} is not a rental product.`)
  if (product.state === 'archived') fail(`Product ${product.code || path} is archived.`)
  if (product.status !== 'available') fail(`Product ${product.code || path} is unavailable for rent.`)
  return product
}

/**
 * Units of `productPath` already reserved by other confirmed or picked-up bookings whose dates overlap
 * `[startDate, endDate]`. Cancelled, returned and draft bookings hold nothing.
 */
export async function reservedUnits(files, productPath, startDate, endDate, exceptPath) {
  let reserved = 0
  for (const { path, record } of await readFolder(files, rental.bookings, rental.mime('booking'), 'booking')) {
    if (path === exceptPath || record.state === 'archived') continue
    if (record.status !== 'confirmed' && record.status !== 'picked-up') continue
    if (record.product !== productPath) continue
    if (!datePattern.test(record.startDate ?? '') || !datePattern.test(record.endDate ?? '')) continue
    if (record.startDate <= endDate && startDate <= record.endDate) reserved += Number(record.quantity) || 0
  }
  return reserved
}

async function confirmBooking(files, path, { now }) {
  const booking = await readRecord(files, checkPath(path, rental.bookings), 'booking')
  const { record } = booking
  checkActive(record)
  if (record.status === 'confirmed' || record.status === 'picked-up' || record.status === 'returned') {
    return { message: `${label(record)} is already ${record.status.split('-').join(' ')}`, path }
  }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled. Reopen it first.`)
  if (!codePattern.test(record.code ?? '')) fail('The booking has no number. Create bookings with New so they are numbered.')
  if (!String(record.customerName ?? '').trim()) fail('Enter the customer\'s name before confirming.')
  const days = rentalDays(record.startDate, record.endDate)
  const quantity = checkQuantity(record.quantity, 'The quantity')
  const product = await readProduct(files, record.product)
  const owned = Number.isInteger(product.quantityOwned) ? product.quantityOwned : 0
  const reserved = await reservedUnits(files, record.product, record.startDate, record.endDate, path)
  if (reserved + quantity > owned) {
    fail(`Only ${Math.max(owned - reserved, 0)} of ${product.code || record.product} ${owned - reserved === 1 ? 'is' : 'are'} available from ${record.startDate} to ${record.endDate} (${owned} owned, ${reserved} reserved by overlapping bookings).`)
  }
  const rate = toMinor(record.dailyRate === '' || record.dailyRate === undefined ? product.dailyRate : record.dailyRate, digits, 'The daily rate')
  if (rate === 0n) fail('The daily rate is zero. Set it on the booking or the product before confirming.')
  const deposit = record.deposit === '' || record.deposit === undefined ? (product.deposit || '0.00') : record.deposit
  const total = rate * BigInt(days) * BigInt(quantity)
  Object.assign(record, {
    status: 'confirmed', confirmedAt: now,
    dailyRate: formatMinor(rate, digits), deposit: formatMinor(toMinor(deposit, digits, 'The deposit'), digits),
    total: formatMinor(total, digits), updatedAt: now,
  })
  await saveRecord(files, booking, rental.mime('booking'))
  return { message: `Confirmed ${label(record)}: ${days} day${days === 1 ? '' : 's'} × ${record.dailyRate} × ${quantity} = ${record.total}`, path }
}

async function pickupBooking(files, path, { now }) {
  const booking = await readRecord(files, checkPath(path, rental.bookings), 'booking')
  const { record } = booking
  checkActive(record)
  if (record.status === 'picked-up' || record.status === 'returned') {
    return { message: `${label(record)} is already ${record.status.split('-').join(' ')}`, path }
  }
  if (record.status !== 'confirmed') fail(`${label(record)} is ${record.status}. Only confirmed bookings can be picked up.`)
  Object.assign(record, { status: 'picked-up', pickedUpAt: now, updatedAt: now })
  await saveRecord(files, booking, rental.mime('booking'))
  return { message: `${label(record)} picked up`, path }
}

/**
 * What Invoicing needs to draft the returned booking's invoice (its `create-draft-invoice` operation): one line for
 * the rental and one for any late fee. The booking form asks Invoicing through the platform; Rental never writes
 * Invoicing's files.
 */
export function invoiceRequest(path, record, { days, late, fee, currency }) {
  const product = nameOf(record.product || '')
  return {
    source: { path, code: record.code },
    currency,
    reference: record.code,
    ...(record.customerRef ? { customerRef: record.customerRef } : {}),
    customer: { name: record.customerName || '' },
    lines: [
      { description: `Rental ${record.code}: ${record.quantity} × ${product}, ${days} day${days === 1 ? '' : 's'} at ${record.dailyRate}/day`,
        quantity: '1', unitPrice: record.total },
      ...(fee > 0n ? [{ description: `Late return: ${late} day${late === 1 ? '' : 's'} past ${record.endDate}`,
        quantity: '1', unitPrice: record.lateFee }] : []),
    ],
    notes: `Drafted from rental booking ${record.code}.`,
  }
}

/** The request for a booking already returned (Invoicing arrived later, or drafting failed). */
async function requestFor(files, path, record) {
  const settings = await readSettings(files, rental.settingsPath, 'Rental')
  const currency = /^[A-Z]{3}$/.test(settings.currency ?? '') ? settings.currency : ''
  const late = lateDays(record.endDate, String(record.returnedAt ?? '').slice(0, 10) || record.endDate)
  const fee = toMinor(record.lateFee || '0', digits, 'The late fee')
  return invoiceRequest(path, record, { days: rentalDays(record.startDate, record.endDate), late, fee, currency })
}

/** Records the invoice Invoicing drafted for a returned booking (the path its operation returned). */
async function recordInvoice(files, path, invoicePath, { now }) {
  const booking = await readRecord(files, checkPath(path, rental.bookings), 'booking')
  const { record } = booking
  if (record.status !== 'returned') fail(`${label(record)} is not returned.`)
  if (typeof invoicePath !== 'string' || !invoicePath.startsWith('/invoices/')) fail('Invoicing returned no invoice.')
  if (record.invoice?.path === invoicePath) return { message: `${label(record)} already links ${nameOf(invoicePath)}`, path }
  Object.assign(record, { invoice: { path: invoicePath }, updatedAt: now })
  await saveRecord(files, booking, rental.mime('booking'))
  return { message: `Drafted invoice ${nameOf(invoicePath)} for ${label(record)}`, path }
}

async function returnBooking(files, path, { date, now }) {
  const booking = await readRecord(files, checkPath(path, rental.bookings), 'booking')
  const { record } = booking
  checkActive(record)
  if (record.status === 'returned') {
    return { message: `${label(record)} is already returned`, path,
      ...(record.invoice?.path ? {} : { invoiceRequest: await requestFor(files, path, record) }) }
  }
  if (record.status !== 'picked-up') fail(`${label(record)} is ${record.status}. Only picked-up bookings can be returned.`)
  const returnDate = typeof date === 'string' && date !== '' ? date : now.slice(0, 10)
  const late = lateDays(record.endDate, returnDate)
  const settings = await readSettings(files, rental.settingsPath, 'Rental')
  const lateRate = toMinor(settings.dailyLateRate || '0', digits, 'The daily late rate in Rental settings')
  const quantity = checkQuantity(record.quantity, 'The quantity')
  const fee = lateRate * BigInt(late) * BigInt(quantity)
  const days = rentalDays(record.startDate, record.endDate)
  const currency = /^[A-Z]{3}$/.test(settings.currency ?? '') ? settings.currency : ''
  Object.assign(record, { lateFee: formatMinor(fee, digits) })
  Object.assign(record, { status: 'returned', returnedAt: now, updatedAt: now })
  await saveRecord(files, booking, rental.mime('booking'))
  const feeNote = fee > 0n ? ` with a ${record.lateFee} late fee (${late} day${late === 1 ? '' : 's'} late)` : ''
  // The form asks Invoicing (when installed) to draft the invoice from this, then records the link.
  return { message: `${label(record)} returned${feeNote}`, path, invoiceRequest: invoiceRequest(path, record, { days, late, fee, currency }) }
}

async function cancelBooking(files, path, { now }) {
  const booking = await readRecord(files, checkPath(path, rental.bookings), 'booking')
  const { record } = booking
  checkActive(record)
  if (record.status === 'cancelled') return { message: `${label(record)} is already cancelled`, path }
  if (record.status !== 'draft' && record.status !== 'confirmed') {
    fail(`${label(record)} is ${record.status.split('-').join(' ')}. Only draft and confirmed bookings can be cancelled.`)
  }
  Object.assign(record, { status: 'cancelled', cancelledAt: now, updatedAt: now })
  await saveRecord(files, booking, rental.mime('booking'))
  return { message: `${label(record)} cancelled`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, date } = parameters ?? {}
  if (operation === 'confirm-booking') return confirmBooking(files, path, { now })
  if (operation === 'pickup-booking') return pickupBooking(files, path, { now })
  if (operation === 'return-booking') return returnBooking(files, path, { date, now })
  if (operation === 'cancel-booking') return cancelBooking(files, path, { now })
  if (operation === 'record-invoice') return recordInvoice(files, path, parameters.invoice, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
