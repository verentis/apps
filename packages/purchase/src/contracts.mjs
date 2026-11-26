// File-based Purchase record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  address, array, code, fileReference, fillTemplate, money, object, optional, optionalCurrency, optionalDate,
  optionalEmail, pathOrEmpty, decimal, schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/purchase'
export const schemaBase = 'https://schemas.verentis.io/purchase/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the data.
export const settingsPath = '/settings/purchase.json'

/**
 * Invoicing (optional) keeps invoices here; receiving a purchase order drafts a vendor bill into it in
 * Invoicing's invoice vendor MIME format when the container exists.
 */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchema: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
}

const vendorMime = kind => `application/vnd.verentis.purchase.${kind}+json`

export const mimeTypes = {
  vendors: 'application/vnd.verentis.purchase.vendors',
  orders: 'application/vnd.verentis.purchase.orders',
  vendor: vendorMime('vendor'),
  order: vendorMime('order'),
  settings: vendorMime('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  vendors: { path: '/vendors', mime: mimeTypes.vendors, holds: ['vendor'] },
  orders: { path: '/purchase-orders', mime: mimeTypes.orders, holds: ['order'] },
}

/** Records are named by a generated code (`PO-0001`) and stored without an extension in their container. */
export const recordKinds = ['vendor', 'order']
export const containerOf = { vendor: 'vendors', order: 'orders' }

export const codeSettings = {
  vendor: { key: 'vendor-code-prefix', default: 'VEND-', label: 'Vendor number prefix' },
  order: { key: 'order-code-prefix', default: 'PO-', label: 'Purchase order number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** A purchase order starts as a draft (an RFQ), is sent, confirmed and received; it can be cancelled before confirmation. */
export const orderStatuses = ['draft', 'sent', 'confirmed', 'received', 'cancelled']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Purchase')
export { schemaId }

/** An ordered line. Quantity and unit price are exact decimal strings; confirming computes the totals. */
export const line = object({
  description: optional(1000),
  quantity: decimal,
  unitPrice: money,
  // Counted on arrival, on a confirmed order. Optional: an order received without counting is received in full.
  received: decimal,
}, ['description', 'quantity', 'unitPrice'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); confirming checks them.
export const schemas = {
  vendor: recordSchema('vendor', 'vendor', {
    code,
    name: optional(200),
    legalName: optional(200),
    contactName: optional(200),
    email: optionalEmail,
    phone: optional(100),
    taxIdentifier: optional(100),
    address,
    paymentTermsDays: { type: 'integer', minimum: 0, maximum: 365 },
    currency: optionalCurrency,
    notes: optional(10000),
  }, ['code', 'name', 'email', 'paymentTermsDays', 'notes']),
  order: recordSchema('order', 'purchase order', {
    code,
    vendor: pathOrEmpty,
    vendorName: optional(200),
    reference: optional(200),
    orderDate: optionalDate,
    expectedDate: optionalDate,
    currency: optionalCurrency,
    lines: array(line, 0, 500),
    notes: optional(10000),
    status: { enum: orderStatuses },
    confirmedAt: timestamp,
    total: money,
    receivedAt: timestamp,
    cancelledAt: timestamp,
    bill: fileReference,
    // Which app asked for this draft (an operation call, e.g. Inventory's reorder); a repeat call returns this order.
    source: object({ app: optional(100), path: optional(1000), code: optional(100) }, []),
  }, ['code', 'vendor', 'orderDate', 'expectedDate', 'currency', 'lines', 'notes', 'status'], [
    whenStatus(['confirmed', 'received'], ['confirmedAt', 'total', 'vendorName']),
    whenStatus(['received'], ['receivedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    defaultCurrency: optionalCurrency,
    defaultLeadDays: { type: 'integer', minimum: 0, maximum: 365 },
    notes: optional(10000),
  }, ['defaultCurrency', 'defaultLeadDays', 'notes']),
}

const emptyAddress = { lines: [], city: '', region: '', postalCode: '', country: '' }
const emptyLine = { description: '', quantity: '1', unitPrice: '' }

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills empty dates, currency and notes from the settings.
 */
export const templates = {
  vendor: recordTemplate('vendor', {
    name: '{{ name }}', legalName: '', contactName: '', email: '', phone: '', taxIdentifier: '',
    address: emptyAddress, paymentTermsDays: 30, currency: '', notes: '',
  }),
  order: recordTemplate('order', {
    vendor: '', vendorName: '', reference: '{{ name }}', orderDate: '', expectedDate: '', currency: '',
    lines: [emptyLine], notes: '', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields (the expected date follows the order date). */
export const createDefaults = {
  vendor: {},
  order: {
    orderDate: 'today',
    expectedDate: { file: settingsPath, pointer: 'defaultLeadDays', addDaysTo: 'orderDate' },
    currency: { file: settingsPath, pointer: 'defaultCurrency' },
    notes: { file: settingsPath, pointer: 'notes' },
  },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultCurrency: '', defaultLeadDays: 7, notes: '',
}

export { fillTemplate }
