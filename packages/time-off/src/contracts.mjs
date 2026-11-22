// File-based Time Off record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  decimal, fillTemplate, code, optional, optionalDate, pathOrEmpty, schemas as schemaKit, text, timestamp,
  whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/time-off'
export const schemaBase = 'https://schemas.verentis.io/time-off/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the requests.
export const settingsPath = '/settings/time-off.json'
/** Employees (optional) keeps the directory here; requests can reference an employee and copy its name. */
export const employees = {
  directory: '/employees',
  employeeMime: 'application/vnd.verentis.employees.employee+json',
}

const vendor = kind => `application/vnd.verentis.time-off.${kind}+json`

export const mimeTypes = {
  types: 'application/vnd.verentis.time-off.types',
  requests: 'application/vnd.verentis.time-off.requests',
  type: vendor('type'),
  request: vendor('request'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  types: { path: '/leave-types', mime: mimeTypes.types, holds: ['type'] },
  requests: { path: '/leave-requests', mime: mimeTypes.requests, holds: ['request'] },
}

/** Records are named by a generated code (`TO-0001`) and stored without an extension in their container. */
export const recordKinds = ['type', 'request']
export const containerOf = { type: 'types', request: 'requests' }

export const codeSettings = {
  type: { key: 'type-code-prefix', default: 'LT-', label: 'Leave type code prefix' },
  request: { key: 'request-code-prefix', default: 'TO-', label: 'Leave request number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Request statuses. `submitted`, `approved` and `refused` are reached only through the script actions. */
export const statuses = ['draft', 'submitted', 'approved', 'refused']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Time Off')
export { schemaId }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  type: recordSchema('type', 'leave type', {
    code,
    name: text,
    daysPerYear: decimal,
    requiresApproval: { type: 'boolean' },
  }, ['code', 'name', 'daysPerYear', 'requiresApproval']),
  request: recordSchema('request', 'leave request', {
    code,
    employeeName: optional(200),
    employeeRef: pathOrEmpty,
    type: pathOrEmpty,
    startDate: optionalDate,
    endDate: optionalDate,
    days: decimal,
    reason: optional(1000),
    status: { enum: statuses },
    submittedAt: timestamp,
    approver: optional(200),
    approvedAt: timestamp,
    refusalReason: optional(1000),
    refusedAt: timestamp,
  }, ['code', 'employeeName', 'employeeRef', 'type', 'startDate', 'endDate', 'days', 'reason', 'status'], [
    whenStatus(['submitted', 'approved', 'refused'], ['submittedAt']),
    whenStatus(['approved'], ['approver', 'approvedAt']),
    whenStatus(['refused'], ['refusalReason', 'refusedAt']),
  ]),
  settings: settingsSchema({
    defaultType: pathOrEmpty,
  }, ['defaultType']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code`, fills the leave type from settings and computes `days` as the weekday count of the
 * date range (empty dates leave it empty; submitting recomputes it).
 */
export const templates = {
  type: recordTemplate('type', { name: '{{ name }}', daysPerYear: '', requiresApproval: true }),
  request: recordTemplate('request', {
    employeeName: '{{ name }}', employeeRef: '', type: '', startDate: '', endDate: '', days: '', reason: '',
    status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields; `days` follows from the date range. */
export const createDefaults = {
  type: {},
  request: { type: { file: settingsPath, pointer: 'defaultType' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const seedTypePath = `${containers.types.path}/LT-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** Starter leave types and a sample draft request, seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('type', 'LT-0001', '9e3f4a5b-6c7d-4e8f-a09b-1c2d3e4f5a01', {
    name: 'Annual leave', daysPerYear: '15', requiresApproval: true,
  }),
  seedRecord('type', 'LT-0002', '9e3f4a5b-6c7d-4e8f-a09b-1c2d3e4f5a02', {
    name: 'Sick leave', daysPerYear: '10', requiresApproval: false,
  }),
  seedRecord('type', 'LT-0003', '9e3f4a5b-6c7d-4e8f-a09b-1c2d3e4f5a03', {
    name: 'Unpaid leave', daysPerYear: '0', requiresApproval: true,
  }),
  seedRecord('request', 'TO-0001', '9e3f4a5b-6c7d-4e8f-a09b-1c2d3e4f5a04', {
    employeeName: 'Avery Adams', employeeRef: '', type: seedTypePath,
    startDate: '2026-02-02', endDate: '2026-02-06', days: '5', reason: 'Family holiday', status: 'draft',
  }),
]
export const starterTypes = starterRecords.filter(record => record.kind === 'type')
export const sampleRequest = starterRecords.find(record => record.kind === 'request')

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultType: seedTypePath,
}

export { fillTemplate }
