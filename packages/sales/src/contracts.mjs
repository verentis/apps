// File-based Sales record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  address, array, code, decimal, fileReference, fillTemplate, money, object, optional, optionalCurrency, optionalDate,
  optionalEmail, pathOrEmpty, schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/sales'
export const schemaBase = 'https://schemas.verentis.io/sales/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the sales data.
export const settingsPath = '/settings/sales.json'
/** CRM (optional) keeps customers here; quotations can copy a customer's details from it. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}
/** Invoicing (optional) keeps invoices here; confirming a quotation can draft one in its vendor format. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchema: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
}

const vendor = kind => `application/vnd.verentis.sales.${kind}+json`

/**
 * Products (required) owns the product catalogue: Sales reads its product files and adds products only through its
 * API (`create-product`).
 */
export const products = {
  path: '/products',
  mime: 'application/vnd.verentis.products.product+json',
}

export const mimeTypes = {
  quotations: 'application/vnd.verentis.sales.quotations',
  orders: 'application/vnd.verentis.sales.orders',
  quotation: vendor('quotation'),
  order: vendor('order'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  quotations: { path: '/quotations', mime: mimeTypes.quotations, holds: ['quotation'] },
  orders: { path: '/sales-orders', mime: mimeTypes.orders, holds: ['order'] },
}

/** Records are named by a generated code (`QUO-0001`) and stored without an extension in their container. */
export const recordKinds = ['quotation', 'order']
export const containerOf = { quotation: 'quotations', order: 'orders' }

export const codeSettings = {
  quotation: { key: 'quotation-code-prefix', default: 'QUO-', label: 'Quotation number prefix' },
  order: { key: 'order-code-prefix', default: 'SO-', label: 'Sales order number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const quotationStatuses = ['draft', 'sent', 'confirmed', 'cancelled']
export const deliveryStatuses = ['pending', 'partial', 'delivered']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Sales')
export { schemaId }

/** A name-and-address snapshot: the customer as they were when the quotation was made. */
export const party = object({
  name: optional(),
  legalName: optional(),
  email: optionalEmail,
  phone: optional(100),
  taxIdentifier: optional(100),
  address,
}, [])

/** A quoted line. Quantity, unit price and discount (percent) are exact decimals; the product reference is optional. */
export const line = object({
  product: pathOrEmpty,
  description: optional(1000),
  quantity: decimal,
  unitPrice: money,
  discount: decimal,
}, ['product', 'description', 'quantity', 'unitPrice', 'discount'])

export const totals = object({ subtotal: money, discount: money, total: money })

// Draft records may be incomplete on disk (a generated record opens straight into its form); confirming checks them.
export const schemas = {
  quotation: recordSchema('quotation', 'quotation', {
    code,
    date: optionalDate,
    currency: optionalCurrency,
    reference: optional(200),
    customerRef: pathOrEmpty,
    customer: party,
    lines: array(line, 0, 500),
    notes: optional(10000),
    status: { enum: quotationStatuses },
    confirmedAt: timestamp,
    totals,
    order: fileReference,
    invoice: fileReference,
  }, ['code', 'date', 'currency', 'customer', 'lines', 'notes', 'status'], [
    whenStatus(['confirmed'], ['confirmedAt', 'totals', 'order']),
  ]),
  order: recordSchema('order', 'sales order', {
    code,
    date: optionalDate,
    currency: optionalCurrency,
    customer: party,
    quotation: pathOrEmpty,
    lines: array(line, 0, 500),
    totals,
    deliveryStatus: { enum: deliveryStatuses },
    notes: optional(10000),
  }, ['code', 'date', 'currency', 'customer', 'lines', 'deliveryStatus']),
  settings: settingsSchema({
    currency: optionalCurrency,
    notes: optional(10000),
  }, ['currency', 'notes']),
}

const emptyParty = { name: '', legalName: '', email: '', phone: '', taxIdentifier: '', address: { lines: [], city: '', region: '', postalCode: '', country: '' } }
const emptyLine = { product: '', description: '', quantity: '1', unitPrice: '', discount: '' }

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills empty dates, currency and notes from the settings.
 */
export const templates = {
  quotation: recordTemplate('quotation', {
    date: '', currency: '', reference: '{{ name }}', customerRef: '', customer: emptyParty,
    lines: [emptyLine], notes: '', status: 'draft',
  }),
  order: recordTemplate('order', {
    date: '', currency: '', customer: emptyParty, quotation: '', lines: [emptyLine], deliveryStatus: 'pending', notes: '',
  }),
}

const defaultCurrency = { file: settingsPath, pointer: 'currency' }
/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  quotation: { date: 'today', currency: defaultCurrency, notes: { file: settingsPath, pointer: 'notes' } },
  order: { date: 'today', currency: defaultCurrency },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  currency: 'ZAR', notes: 'Prices are valid for 30 days.',
}

export { fillTemplate }
