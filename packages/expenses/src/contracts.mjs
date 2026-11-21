// File-based Expenses record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fileReference, fillTemplate, money, object, optional, optionalDate, pathOrEmpty,
  schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/expenses'
export const schemaBase = 'https://schemas.verentis.io/expenses/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the reports.
export const settingsPath = '/settings/expenses.json'
/** Accounting owns the ledger: its settings give the currency, and its chart of accounts the posting accounts. */
export const accountingSettingsPath = '/settings/accounting.json'
export const accounting = {
  accounts: '/chart-of-accounts',
  periods: '/periods',
  journals: '/journals',
  accountMime: 'application/vnd.verentis.accounting.account+json',
}

const vendor = kind => `application/vnd.verentis.expenses.${kind}+json`

export const mimeTypes = {
  categories: 'application/vnd.verentis.expenses.categories',
  reports: 'application/vnd.verentis.expenses.reports',
  category: vendor('category'),
  report: vendor('report'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  categories: { path: '/expense-categories', mime: mimeTypes.categories, holds: ['category'] },
  reports: { path: '/expense-reports', mime: mimeTypes.reports, holds: ['report'] },
}

/** Records are named by a generated code (`EXP-0001`) and stored without an extension in their container. */
export const recordKinds = ['category', 'report']
export const containerOf = { category: 'categories', report: 'reports' }

export const codeSettings = {
  category: { key: 'category-code-prefix', default: 'CAT-', label: 'Category code prefix' },
  report: { key: 'report-code-prefix', default: 'EXP-', label: 'Expense report number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const reportStatuses = ['draft', 'submitted', 'approved', 'refused', 'posted']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Expenses')
export { schemaId }

/** An expensed line: what was spent, against which category, on which day. Amounts are exact decimal strings. */
export const line = object({
  category: pathOrEmpty,
  description: optional(1000),
  amount: money,
  date: optionalDate,
}, ['category', 'description', 'amount', 'date'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); submitting checks them.
export const schemas = {
  category: recordSchema('category', 'expense category', {
    code,
    name: optional(200),
    expenseAccount: pathOrEmpty,
  }, ['code', 'name', 'expenseAccount']),
  report: recordSchema('report', 'expense report', {
    code,
    employeeName: optional(200),
    employeeRef: optional(100),
    date: optionalDate,
    lines: array(line, 0, 200),
    status: { enum: reportStatuses },
    submittedAt: timestamp,
    total: money,
    approver: optional(200),
    approvedAt: timestamp,
    refusalReason: optional(1000),
    refusedAt: timestamp,
    postedAt: timestamp,
    journal: fileReference,
  }, ['code', 'employeeName', 'employeeRef', 'date', 'lines', 'status'], [
    whenStatus(['submitted', 'approved', 'refused', 'posted'], ['submittedAt', 'total']),
    whenStatus(['approved', 'posted'], ['approver', 'approvedAt']),
    whenStatus(['refused'], ['refusalReason', 'refusedAt']),
    whenStatus(['posted'], ['postedAt', 'journal']),
  ]),
  settings: settingsSchema({
    reimbursementAccount: pathOrEmpty,
  }, ['reimbursementAccount']),
}

const emptyLine = { category: '', description: '', amount: '', date: '' }

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the empty report date.
 */
export const templates = {
  category: recordTemplate('category', { name: '{{ name }}', expenseAccount: '' }),
  report: recordTemplate('report', {
    employeeName: '{{ name }}', employeeRef: '', date: '', lines: [emptyLine], status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  category: {},
  report: { date: 'today' },
}

// The Accounting starter chart of accounts (Bank, General expenses).
const account = code => `${accounting.accounts}/${code}`
const seedTime = '2026-01-01T00:00:00Z'

/** Starter categories seeded (install-once, kept) into the categories container. */
export const starterCategories = [
  ['CAT-0001', 'Travel', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c01'],
  ['CAT-0002', 'Meals and entertainment', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c02'],
  ['CAT-0003', 'Office supplies', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c03'],
].map(([categoryCode, name, id]) => ({
  $schema: schemaId('category'), schemaVersion: 1, kind: 'category', id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: categoryCode, name, expenseAccount: account('ACC-0006'),
}))

/** A sample draft report seeded (install-once, kept) into the reports container. */
export const sampleReport = {
  $schema: schemaId('report'), schemaVersion: 1, kind: 'report', id: '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c10',
  state: 'active', createdAt: seedTime, updatedAt: seedTime, code: 'EXP-0001',
  employeeName: 'Alex Example', employeeRef: '', date: '',
  lines: [{ category: `${containers.categories.path}/CAT-0001`, description: 'Taxi from the airport', amount: '250.00', date: '' }],
  status: 'draft',
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  reimbursementAccount: account('ACC-0001'),
}

export { fillTemplate }
