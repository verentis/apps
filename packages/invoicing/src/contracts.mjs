// File-based Invoicing record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  address, array, code, decimal, fileReference, fillTemplate, money, object, optional, optionalCurrency, optionalDate,
  optionalEmail, pathOrEmpty, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/invoicing'
export const schemaBase = 'https://schemas.verentis.io/invoicing/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the invoices.
export const settingsPath = '/settings/invoicing.json'
/** Accounting owns the ledger: its settings give the currency, and its chart of accounts the posting accounts. */
export const accountingSettingsPath = '/settings/accounting.json'
export const accounting = {
  accounts: '/chart-of-accounts',
  periods: '/periods',
  journals: '/journals',
  accountMime: 'application/vnd.verentis.accounting.account+json',
}
/** CRM (optional) keeps customers here; invoices can copy a customer's details from it. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}

const vendor = kind => `application/vnd.verentis.invoicing.${kind}+json`

export const mimeTypes = {
  invoices: 'application/vnd.verentis.invoicing.invoices',
  credits: 'application/vnd.verentis.invoicing.credits',
  payments: 'application/vnd.verentis.invoicing.payments',
  invoice: vendor('invoice'),
  credit: vendor('credit'),
  payment: vendor('payment'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  invoices: { path: '/invoices', mime: mimeTypes.invoices, holds: ['invoice'] },
  credits: { path: '/credit-notes', mime: mimeTypes.credits, holds: ['credit'] },
  payments: { path: '/payments', mime: mimeTypes.payments, holds: ['payment'] },
}

/** Records are named by a generated code (`INV-0001`) and stored without an extension in their container. */
export const recordKinds = ['invoice', 'credit', 'payment']
export const containerOf = { invoice: 'invoices', credit: 'credits', payment: 'payments' }

export const codeSettings = {
  invoice: { key: 'invoice-code-prefix', default: 'INV-', label: 'Invoice number prefix' },
  credit: { key: 'credit-code-prefix', default: 'CN-', label: 'Credit note number prefix' },
  payment: { key: 'payment-code-prefix', default: 'PAY-', label: 'Payment code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const paymentMethods = ['bank-transfer', 'card', 'cash', 'other']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Invoicing')
export { schemaId }

/** A name-and-address snapshot: the seller and customer as they were when the document was issued. */
export const party = object({
  name: optional(),
  legalName: optional(),
  email: optionalEmail,
  phone: optional(100),
  taxIdentifier: optional(100),
  address,
}, [])

/** A billed line. Quantity, unit price and tax rate (percent) are exact decimals; an empty tax rate takes the default. */
export const line = object({
  description: optional(1000),
  quantity: decimal,
  unitPrice: money,
  taxRate: decimal,
}, ['description', 'quantity', 'unitPrice', 'taxRate'])

export const totals = object({ net: money, tax: money, gross: money })

const issued = ['issuedAt', 'totals', 'journal', 'document']

// Draft records may be incomplete on disk (a generated record opens straight into its form); issuing checks them.
export const schemas = {
  invoice: recordSchema('invoice', 'invoice', {
    code,
    issueDate: optionalDate,
    dueDate: optionalDate,
    currency: optionalCurrency,
    reference: optional(200),
    customerRef: pathOrEmpty,
    customer: party,
    seller: party,
    lines: array(line, 0, 500),
    notes: optional(10000),
    status: { enum: ['draft', 'issued'] },
    issuedAt: timestamp,
    totals,
    journal: fileReference,
    document: fileReference,
  }, ['code', 'issueDate', 'dueDate', 'currency', 'customer', 'lines', 'notes', 'status'], [
    whenStatus(['issued'], [...issued, 'seller']),
  ]),
  credit: recordSchema('credit', 'credit note', {
    code,
    date: optionalDate,
    currency: optionalCurrency,
    invoice: pathOrEmpty,
    reason: optional(1000),
    customer: party,
    lines: array(line, 0, 500),
    status: { enum: ['draft', 'issued'] },
    issuedAt: timestamp,
    totals,
    journal: fileReference,
    document: fileReference,
  }, ['code', 'date', 'currency', 'invoice', 'reason', 'lines', 'status'], [
    whenStatus(['issued'], [...issued, 'customer']),
  ]),
  payment: recordSchema('payment', 'payment', {
    code,
    date: optionalDate,
    currency: optionalCurrency,
    amount: money,
    method: { enum: paymentMethods },
    payer: optional(),
    reference: optional(200),
    bankAccount: pathOrEmpty,
    allocations: array(object({ invoice: pathOrEmpty, amount: money }), 0, 500),
    status: { enum: ['draft', 'posted', 'reversed'] },
    postedAt: timestamp,
    journal: fileReference,
    reversalJournal: fileReference,
    reversedAt: timestamp,
  }, ['code', 'date', 'currency', 'amount', 'method', 'bankAccount', 'allocations', 'status'], [
    whenStatus(['posted', 'reversed'], ['postedAt', 'journal']),
    whenStatus(['reversed'], ['reversalJournal', 'reversedAt']),
  ]),
  settings: settingsSchema({
    seller: party,
    defaultDueDays: { type: 'integer', minimum: 0, maximum: 365 },
    defaultTaxRate: decimal,
    notes: optional(10000),
    receivableAccount: pathOrEmpty,
    incomeAccount: pathOrEmpty,
    taxAccount: pathOrEmpty,
    bankAccount: pathOrEmpty,
  }, ['seller', 'defaultDueDays', 'defaultTaxRate', 'notes', 'receivableAccount', 'incomeAccount', 'taxAccount', 'bankAccount']),
}

const emptyParty = { name: '', legalName: '', email: '', phone: '', taxIdentifier: '', address: { lines: [], city: '', region: '', postalCode: '', country: '' } }
const emptyLine = { description: '', quantity: '1', unitPrice: '', taxRate: '' }

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills empty dates, currency, notes and bank account from the settings.
 */
export const templates = {
  invoice: recordTemplate('invoice', {
    issueDate: '', dueDate: '', currency: '', reference: '{{ name }}', customerRef: '', customer: emptyParty,
    lines: [emptyLine], notes: '', status: 'draft',
  }),
  credit: recordTemplate('credit', { date: '', currency: '', invoice: '', reason: '{{ name }}', lines: [emptyLine], status: 'draft' }),
  payment: recordTemplate('payment', {
    date: '', currency: '', amount: '', method: 'bank-transfer', payer: '', reference: '{{ name }}', bankAccount: '', allocations: [], status: 'draft',
  }),
}

const baseCurrency = { file: accountingSettingsPath, pointer: 'baseCurrency' }
/** Defaults the create script fills into empty template fields (in order: the due date follows the issue date). */
export const createDefaults = {
  invoice: {
    issueDate: 'today', dueDate: { file: settingsPath, pointer: 'defaultDueDays', addDaysTo: 'issueDate' },
    currency: baseCurrency, notes: { file: settingsPath, pointer: 'notes' },
  },
  credit: { date: 'today', currency: baseCurrency },
  payment: { date: 'today', currency: baseCurrency, bankAccount: { file: settingsPath, pointer: 'bankAccount' } },
}

// The Accounting starter chart of accounts (Bank, Accounts receivable, Sales tax, Sales).
const account = code => `${accounting.accounts}/${code}`
export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  seller: emptyParty, defaultDueDays: 30, defaultTaxRate: '15', notes: 'Thank you for your business.',
  receivableAccount: account('ACC-0002'), incomeAccount: account('ACC-0005'), taxAccount: account('ACC-0003'), bankAccount: account('ACC-0001'),
}

export { fillTemplate }
