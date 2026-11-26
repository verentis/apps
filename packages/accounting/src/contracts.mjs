// File-based Accounting record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, date, decimal, fileReference, fillTemplate, money, object, optional, optionalCountry, optionalCurrency,
  optionalDate, pathOrEmpty, requires, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/accounting'
export const schemaBase = 'https://schemas.verentis.io/accounting/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the ledger.
export const settingsPath = '/settings/accounting.json'

const vendor = kind => `application/vnd.verentis.accounting.${kind}+json`

export const mimeTypes = {
  accounts: 'application/vnd.verentis.accounting.accounts',
  periods: 'application/vnd.verentis.accounting.periods',
  journals: 'application/vnd.verentis.accounting.journals',
  expenses: 'application/vnd.verentis.accounting.expenses',
  account: vendor('account'),
  period: vendor('period'),
  journal: vendor('journal'),
  expense: vendor('expense'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  accounts: { path: '/chart-of-accounts', mime: mimeTypes.accounts, holds: ['account'] },
  periods: { path: '/periods', mime: mimeTypes.periods, holds: ['period'] },
  journals: { path: '/journals', mime: mimeTypes.journals, holds: ['journal'] },
  expenses: { path: '/expenses', mime: mimeTypes.expenses, holds: ['expense'] },
}

/** Records are named by a generated code (`JRN-0001`) and stored without an extension in their container. */
export const recordKinds = ['account', 'period', 'journal', 'expense']
export const containerOf = { account: 'accounts', period: 'periods', journal: 'journals', expense: 'expenses' }

export const codeSettings = {
  account: { key: 'account-code-prefix', default: 'ACC-', label: 'Account code prefix' },
  period: { key: 'period-code-prefix', default: 'PER-', label: 'Period code prefix' },
  journal: { key: 'journal-code-prefix', default: 'JRN-', label: 'Journal code prefix' },
  expense: { key: 'expense-code-prefix', default: 'EXP-', label: 'Expense code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const accountTypes = ['asset', 'liability', 'equity', 'income', 'expense']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Accounting')
export { schemaId }

/** One side of a journal: an account path, a direction and an exact decimal amount. */
export const journalLine = object({
  account: pathOrEmpty,
  direction: { enum: ['debit', 'credit'] },
  amount: money,
  description: optional(500),
}, ['account', 'direction', 'amount'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); posting checks them.
export const schemas = {
  account: recordSchema('account', 'account', {
    code,
    number: optional(32),
    name: text,
    accountType: { enum: accountTypes },
    description: optional(10000),
  }, ['code', 'name', 'accountType']),
  period: recordSchema('period', 'period', {
    code,
    name: text,
    startDate: optionalDate,
    endDate: optionalDate,
    status: { enum: ['open', 'closed'] },
    closedAt: timestamp,
  }, ['code', 'name', 'startDate', 'endDate', 'status'], [
    whenStatus(['closed'], ['closedAt']),
    { if: { properties: { status: { const: 'closed' } }, required: ['status'] }, then: { properties: { startDate: date, endDate: date } } },
  ]),
  journal: recordSchema('journal', 'journal', {
    code,
    date: optionalDate,
    description: text,
    currency: optionalCurrency,
    period: fileReference,
    lines: array(journalLine, 0, 1000),
    status: { enum: ['draft', 'posted'] },
    postedAt: timestamp,
    source: fileReference,
    reversalOf: fileReference,
    reversedBy: fileReference,
    reversedAt: timestamp,
    // The app that posted it through Accounting's API (post-journal); only that app may reverse it the same way.
    postedBy: object({ app: optional(100) }, []),
  }, ['code', 'date', 'description', 'currency', 'lines', 'status'], [
    whenStatus(['posted'], ['postedAt', 'period']),
    { if: requires(['reversedBy']), then: requires(['reversedAt']) },
  ]),
  expense: recordSchema('expense', 'expense', {
    code,
    date: optionalDate,
    description: text,
    payee: optional(),
    currency: optionalCurrency,
    netAmount: money,
    taxAmount: money,
    grossAmount: money,
    taxCode: optional(32),
    expenseAccount: pathOrEmpty,
    paymentAccount: pathOrEmpty,
    status: { enum: ['draft', 'posted', 'reversed'] },
    journal: fileReference,
    reversalJournal: fileReference,
    postedAt: timestamp,
    reversedAt: timestamp,
  }, ['code', 'date', 'description', 'currency', 'netAmount', 'taxAmount', 'status'], [
    whenStatus(['posted', 'reversed'], ['journal', 'postedAt', 'grossAmount']),
    whenStatus(['reversed'], ['reversalJournal', 'reversedAt']),
  ]),
  settings: settingsSchema({
    country: optionalCountry,
    baseCurrency: optionalCurrency,
    minorDigits: { type: 'integer', minimum: 0, maximum: 4 },
    fiscalYearStartMonth: { type: 'integer', minimum: 1, maximum: 12 },
    taxCodes: array(object({
      code: { type: 'string', minLength: 1, maxLength: 32 },
      name: text,
      ratePercent: decimal,
      account: pathOrEmpty,
    }, ['code', 'name', 'ratePercent', 'account']), 0, 100),
  }, ['baseCurrency', 'minorDigits', 'fiscalYearStartMonth', 'taxCodes']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills an empty date with today and an empty currency with the base currency.
 */
export const templates = {
  account: recordTemplate('account', { number: '', name: '{{ name }}', accountType: 'expense' }),
  period: recordTemplate('period', { name: '{{ name }}', startDate: '', endDate: '', status: 'open' }),
  journal: recordTemplate('journal', {
    date: '', description: '{{ name }}', currency: '', status: 'draft',
    lines: [{ account: '', direction: 'debit', amount: '' }, { account: '', direction: 'credit', amount: '' }],
  }),
  expense: recordTemplate('expense', {
    date: '', description: '{{ name }}', payee: '', currency: '', netAmount: '', taxAmount: '0', taxCode: '',
    expenseAccount: '', paymentAccount: '', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  journal: { date: 'today', currency: { file: settingsPath, pointer: 'baseCurrency' } },
  expense: { date: 'today', currency: { file: settingsPath, pointer: 'baseCurrency' } },
}

const seedTime = '2026-01-01T00:00:00Z'
/** A small starter chart of accounts, seeded once. Invoicing and the tax code default to these paths. */
export const starterAccounts = [
  ['ACC-0001', '1000', 'Bank', 'asset', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e01'],
  ['ACC-0002', '1100', 'Accounts receivable', 'asset', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e02'],
  ['ACC-0003', '2100', 'Sales tax', 'liability', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e03'],
  ['ACC-0004', '3000', 'Owner\'s equity', 'equity', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e04'],
  ['ACC-0005', '4000', 'Sales', 'income', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e05'],
  ['ACC-0006', '5000', 'General expenses', 'expense', '6f9a3d1e-2b4c-4e8a-9f10-1a2b3c4d5e06'],
].map(([accountCode, number, name, accountType, id]) => ({
  $schema: schemaId('account'), schemaVersion: 1, kind: 'account', id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: accountCode, number, name, accountType,
}))
export const accountPath = accountCode => `${containers.accounts.path}/${accountCode}`

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, country: '', baseCurrency: '', minorDigits: 2, fiscalYearStartMonth: 1,
  taxCodes: [{ code: 'VAT', name: 'Value-added tax', ratePercent: '15', account: accountPath('ACC-0003') }],
}

export { fillTemplate }
