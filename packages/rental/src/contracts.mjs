// File-based Rental record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fileReference, fillTemplate, money, optional, optionalCurrency, optionalDate, pathOrEmpty,
  schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/rental'
export const schemaBase = 'https://schemas.verentis.io/rental/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the rental data.
export const settingsPath = '/settings/rental.json'
/** CRM (optional) keeps customers here; bookings can name a customer from it. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}
/** Invoicing (optional) keeps invoices here; returning a booking can draft one in its vendor format. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchema: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
}

const vendor = kind => `application/vnd.verentis.rental.${kind}+json`

export const mimeTypes = {
  products: 'application/vnd.verentis.rental.products',
  bookings: 'application/vnd.verentis.rental.bookings',
  product: vendor('product'),
  booking: vendor('booking'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  products: { path: '/rental-products', mime: mimeTypes.products, holds: ['product'] },
  bookings: { path: '/rental-bookings', mime: mimeTypes.bookings, holds: ['booking'] },
}

/** Records are named by a generated code (`RENT-0001`) and stored without an extension in their container. */
export const recordKinds = ['product', 'booking']
export const containerOf = { product: 'products', booking: 'bookings' }

export const codeSettings = {
  product: { key: 'product-code-prefix', default: 'RPRD-', label: 'Rental product code prefix' },
  booking: { key: 'booking-code-prefix', default: 'RENT-', label: 'Booking number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const productStatuses = ['available', 'unavailable']
export const bookingStatuses = ['draft', 'confirmed', 'picked-up', 'returned', 'cancelled']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Rental')
export { schemaId }

/** A non-negative whole number of units (owned or booked). */
export const quantity = { type: 'integer', minimum: 0, maximum: 100000 }

// Draft records may be incomplete on disk (a generated record opens straight into its form); confirming checks them.
export const schemas = {
  product: recordSchema('product', 'product', {
    code,
    name: optional(200),
    dailyRate: money,
    deposit: money,
    quantityOwned: quantity,
    description: optional(1000),
    status: { enum: productStatuses },
  }, ['code', 'name', 'dailyRate', 'deposit', 'quantityOwned', 'description', 'status']),
  booking: recordSchema('booking', 'booking', {
    code,
    customerRef: pathOrEmpty,
    customerName: optional(200),
    product: pathOrEmpty,
    quantity,
    startDate: optionalDate,
    endDate: optionalDate,
    dailyRate: money,
    deposit: money,
    notes: optional(10000),
    status: { enum: bookingStatuses },
    confirmedAt: timestamp,
    total: money,
    pickedUpAt: timestamp,
    returnedAt: timestamp,
    lateFee: money,
    invoice: fileReference,
    cancelledAt: timestamp,
  }, ['code', 'customerRef', 'customerName', 'product', 'quantity', 'startDate', 'endDate', 'dailyRate', 'deposit', 'notes', 'status'], [
    whenStatus(['confirmed', 'picked-up', 'returned'], ['confirmedAt', 'total']),
    whenStatus(['picked-up', 'returned'], ['pickedUpAt']),
    whenStatus(['returned'], ['returnedAt', 'lateFee']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    currency: optionalCurrency,
    dailyLateRate: money,
    notes: optional(10000),
  }, ['currency', 'dailyLateRate', 'notes']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills the empty start date.
 */
export const templates = {
  product: recordTemplate('product', {
    name: '{{ name }}', dailyRate: '', deposit: '', quantityOwned: 1, description: '', status: 'available',
  }),
  booking: recordTemplate('booking', {
    customerRef: '', customerName: '{{ name }}', product: '', quantity: 1, startDate: '', endDate: '',
    dailyRate: '', deposit: '', notes: '', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  product: {},
  booking: { startDate: 'today', notes: { file: settingsPath, pointer: 'notes' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  currency: 'ZAR', dailyLateRate: '0.00', notes: '',
}

export { fillTemplate }
