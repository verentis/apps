// File-based Payroll record contracts. Every record is one JSON file whose vendor MIME names its kind.
// The payroll engine is region-agnostic: there are no country-specific tax tables baked in — salary
// structures and their rules are user data computed verbatim by the posting script.
import {
  array, code, decimal, fileReference, fillTemplate, money, object, optional, optionalCurrency, pathOrEmpty,
  schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/payroll'
export const schemaBase = 'https://schemas.verentis.io/payroll/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the payroll data.
export const settingsPath = '/settings/payroll.json'
/** Accounting owns the ledger: its settings give the currency, and its chart of accounts the posting accounts. */
export const accountingSettingsPath = '/settings/accounting.json'
export const accounting = {
  accounts: '/chart-of-accounts',
  periods: '/periods',
  journals: '/journals',
  accountMime: 'application/vnd.verentis.accounting.account+json',
}
/** Employees (optional) keeps employee records here; pay profiles can link to one. */
export const employees = {
  root: '/employees',
  employeeMime: 'application/vnd.verentis.employees.employee+json',
}

const vendor = kind => `application/vnd.verentis.payroll.${kind}+json`

export const mimeTypes = {
  structures: 'application/vnd.verentis.payroll.structures',
  profiles: 'application/vnd.verentis.payroll.profiles',
  runs: 'application/vnd.verentis.payroll.payruns',
  structure: vendor('structure'),
  profile: vendor('profile'),
  payrun: vendor('payrun'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  structures: { path: '/salary-structures', mime: mimeTypes.structures, holds: ['structure'] },
  profiles: { path: '/pay-profiles', mime: mimeTypes.profiles, holds: ['profile'] },
  runs: { path: '/pay-runs', mime: mimeTypes.runs, holds: ['payrun'] },
}

/** Records are named by a generated code (`PAYRUN-0001`) and stored without an extension in their container. */
export const recordKinds = ['structure', 'profile', 'payrun']
export const containerOf = { structure: 'structures', profile: 'profiles', payrun: 'runs' }

export const codeSettings = {
  structure: { key: 'structure-code-prefix', default: 'PAYSTR-', label: 'Salary structure code prefix' },
  profile: { key: 'profile-code-prefix', default: 'PAYEMP-', label: 'Pay profile code prefix' },
  payrun: { key: 'payrun-code-prefix', default: 'PAYRUN-', label: 'Pay run code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Rule kinds are the engine's only taxonomy; what each rule means (tax, pension, bonus…) is user data. */
export const ruleKinds = ['earning', 'deduction', 'employer-contribution']
export const computations = ['fixed', 'percent-of-base']
export const runStatuses = ['draft', 'computed', 'approved', 'posted']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Payroll')
export { schemaId }

const optionalCode = { type: 'string', maxLength: 64, pattern: '^([A-Za-z0-9][A-Za-z0-9._-]*)?$' }
/** A `YYYY-MM` pay period; empty while a run is being drafted. */
export const optionalPeriod = { type: 'string', pattern: '^([0-9]{4}-(0[1-9]|1[0-2]))?$' }

/** A structure rule. `amount` applies to `fixed`, `rate` (percent) to `percent-of-base`; both are exact decimal strings. */
export const rule = object({
  code: optionalCode,
  name: optional(200),
  kind: { enum: ruleKinds },
  computation: { enum: computations },
  amount: money,
  rate: decimal,
  sequence: decimal,
}, ['code', 'name', 'kind', 'computation', 'amount', 'rate', 'sequence'])

/** A computed payslip line: one structure rule applied to one employee's base. */
export const payslipLine = object({
  rule: optionalCode,
  name: optional(200),
  kind: { enum: ruleKinds },
  amount: money,
}, ['rule', 'name', 'kind', 'amount'])

/** One employee's computed payslip, inlined in the pay run. */
export const payslip = object({
  employee: optional(200),
  profile: pathOrEmpty,
  base: money,
  lines: array(payslipLine, 0, 100),
  gross: money,
  deductions: money,
  contributions: money,
  net: money,
}, ['employee', 'profile', 'base', 'lines', 'gross', 'deductions', 'contributions', 'net'])

export const totals = object({ gross: money, deductions: money, contributions: money, net: money })

// Draft records may be incomplete on disk (a generated record opens straight into its form); computing checks them.
export const schemas = {
  structure: recordSchema('structure', 'salary structure', {
    code,
    name: optional(200),
    rules: array(rule, 0, 100),
  }, ['code', 'name', 'rules']),
  profile: recordSchema('profile', 'pay profile', {
    code,
    employeeName: optional(200),
    employeeRef: pathOrEmpty,
    structure: pathOrEmpty,
    baseWage: money,
    currency: optionalCurrency,
    active: { type: 'boolean' },
  }, ['code', 'employeeName', 'employeeRef', 'structure', 'baseWage', 'currency', 'active']),
  payrun: recordSchema('payrun', 'pay run', {
    code,
    period: optionalPeriod,
    currency: optionalCurrency,
    status: { enum: runStatuses },
    payslips: array(payslip, 0, 1000),
    totals,
    computedAt: timestamp,
    approvedAt: timestamp,
    postedAt: timestamp,
    journal: fileReference,
  }, ['code', 'period', 'status', 'payslips'], [
    whenStatus(['computed', 'approved', 'posted'], ['computedAt', 'totals', 'currency']),
    whenStatus(['approved', 'posted'], ['approvedAt']),
    whenStatus(['posted'], ['postedAt', 'journal']),
  ]),
  settings: settingsSchema({
    wageExpenseAccount: pathOrEmpty,
    deductionsPayableAccount: pathOrEmpty,
    netWagesPayableAccount: pathOrEmpty,
    contributionExpenseAccount: pathOrEmpty,
    contributionPayableAccount: pathOrEmpty,
  }, ['wageExpenseAccount', 'deductionsPayableAccount', 'netWagesPayableAccount', 'contributionExpenseAccount', 'contributionPayableAccount']),
}

const baseRule = { code: 'BASE', name: 'Base salary', kind: 'earning', computation: 'percent-of-base', amount: '', rate: '100', sequence: '10' }

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the empty currency from the Accounting settings.
 */
export const templates = {
  structure: recordTemplate('structure', { name: '{{ name }}', rules: [baseRule] }),
  profile: recordTemplate('profile', { employeeName: '{{ name }}', employeeRef: '', structure: '', baseWage: '', currency: '', active: true }),
  payrun: recordTemplate('payrun', { period: '', currency: '', status: 'draft', payslips: [] }),
}

const baseCurrency = { file: accountingSettingsPath, pointer: 'baseCurrency' }
/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  structure: {},
  profile: { currency: baseCurrency },
  payrun: { currency: baseCurrency },
}

// The Accounting starter chart of accounts: expenses post to General expenses until mapped; payables must be chosen.
const account = code => `${accounting.accounts}/${code}`
export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  wageExpenseAccount: account('ACC-0006'),
  deductionsPayableAccount: '',
  netWagesPayableAccount: '',
  contributionExpenseAccount: account('ACC-0006'),
  contributionPayableAccount: '',
}

const seedTime = '2026-01-01T00:00:00Z'
const seedRecord = (kind, code, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code, ...fields,
})

/** A region-agnostic sample: 100% base earning, an example 10% deduction and an example 5% employer contribution. */
export const seedStructures = [
  seedRecord('structure', 'PAYSTR-0001', '7c1e5a2b-3d4f-4a6b-8c90-1a2b3c4d5e01', {
    name: 'Standard salary',
    rules: [
      baseRule,
      { code: 'DED', name: 'Example deduction (10%)', kind: 'deduction', computation: 'percent-of-base', amount: '', rate: '10', sequence: '20' },
      { code: 'EC', name: 'Example employer contribution (5%)', kind: 'employer-contribution', computation: 'percent-of-base', amount: '', rate: '5', sequence: '30' },
    ],
  }),
]

export const seedProfiles = [
  seedRecord('profile', 'PAYEMP-0001', '7c1e5a2b-3d4f-4a6b-8c90-1a2b3c4d5e02', {
    employeeName: 'Alex Taylor', employeeRef: '', structure: `${containers.structures.path}/PAYSTR-0001`,
    baseWage: '20000.00', currency: '', active: true,
  }),
  seedRecord('profile', 'PAYEMP-0002', '7c1e5a2b-3d4f-4a6b-8c90-1a2b3c4d5e03', {
    employeeName: 'Jordan Lee', employeeRef: '', structure: `${containers.structures.path}/PAYSTR-0001`,
    baseWage: '15000.00', currency: '', active: true,
  }),
]

export const seedRuns = [
  seedRecord('payrun', 'PAYRUN-0001', '7c1e5a2b-3d4f-4a6b-8c90-1a2b3c4d5e04', {
    period: '', currency: '', status: 'draft', payslips: [],
  }),
]

/** Every seeded record with the seed file it is packaged in and the container child it installs to. */
export const seedRecords = [
  ...seedStructures.map(record => ({ record, from: `seed/sample/${record.code}.json`, to: `${containers.structures.path}/${record.code}`, mime: mimeTypes.structure })),
  ...seedProfiles.map(record => ({ record, from: `seed/sample/${record.code}.json`, to: `${containers.profiles.path}/${record.code}`, mime: mimeTypes.profile })),
  ...seedRuns.map(record => ({ record, from: `seed/sample/${record.code}.json`, to: `${containers.runs.path}/${record.code}`, mime: mimeTypes.payrun })),
]

export { fillTemplate }
