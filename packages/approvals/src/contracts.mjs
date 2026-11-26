// File-based Approvals record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fillTemplate, money, object, optional, optionalDate, pathOrEmpty, schemas as schemaKit,
  timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/approvals'
export const schemaBase = 'https://schemas.verentis.io/approvals/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the requests.
export const settingsPath = '/settings/approvals.json'

const vendor = kind => `application/vnd.verentis.approvals.${kind}+json`

export const mimeTypes = {
  types: 'application/vnd.verentis.approvals.types',
  requests: 'application/vnd.verentis.approvals.requests',
  type: vendor('type'),
  request: vendor('request'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  types: { path: '/approval-types', mime: mimeTypes.types, holds: ['type'] },
  requests: { path: '/approval-requests', mime: mimeTypes.requests, holds: ['request'] },
}

/** Records are named by a generated code (`APR-0001`) and stored without an extension in their container. */
export const recordKinds = ['type', 'request']
export const containerOf = { type: 'types', request: 'requests' }

export const codeSettings = {
  type: { key: 'type-code-prefix', default: 'APT-', label: 'Approval type code prefix' },
  request: { key: 'request-code-prefix', default: 'APR-', label: 'Approval request number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const requestStatuses = ['draft', 'submitted', 'approved', 'refused', 'cancelled']
export const decisions = ['approve', 'refuse']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Approvals')
export { schemaId }

/** One approver's decision on a request: who, when, approve or refuse, and an optional comment. */
export const approvalEntry = object({
  approver: optional(200),
  date: timestamp,
  decision: { enum: decisions },
  comment: optional(1000),
}, ['approver', 'date', 'decision', 'comment'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); submitting checks them.
export const schemas = {
  type: recordSchema('type', 'approval type', {
    code,
    name: optional(200),
    description: optional(1000),
    requiredApprovers: { type: 'integer', minimum: 1, maximum: 20 },
    requiresAmount: { type: 'boolean' },
    requiresDate: { type: 'boolean' },
    requiresReference: { type: 'boolean' },
  }, ['code', 'name', 'description', 'requiredApprovers', 'requiresAmount', 'requiresDate', 'requiresReference']),
  request: recordSchema('request', 'approval request', {
    code,
    type: pathOrEmpty,
    title: optional(200),
    requester: optional(200),
    // The requester's Employees record; empty when they are named only (Employees not installed).
    requesterRef: pathOrEmpty,
    amount: money,
    date: optionalDate,
    reference: optional(200),
    reason: optional(1000),
    status: { enum: requestStatuses },
    approvals: array(approvalEntry, 0, 50),
    submittedAt: timestamp,
    decidedAt: timestamp,
    cancelledAt: timestamp,
  }, ['code', 'type', 'title', 'requester', 'amount', 'date', 'reference', 'reason', 'status', 'approvals'], [
    whenStatus(['submitted', 'approved', 'refused'], ['submittedAt']),
    whenStatus(['approved', 'refused'], ['decidedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    defaultRequester: optional(200),
  }, ['defaultRequester']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills the requester from the settings when the creator is unknown.
 */
export const templates = {
  type: recordTemplate('type', {
    name: '{{ name }}', description: '', requiredApprovers: 1,
    requiresAmount: false, requiresDate: false, requiresReference: false,
  }),
  request: recordTemplate('request', {
    type: '', title: '{{ name }}', requester: '{{ user }}', requesterRef: '', amount: '', date: '', reference: '', reason: '',
    status: 'draft', approvals: [],
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  type: {},
  request: { requester: { file: settingsPath, pointer: 'defaultRequester' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const typePath = typeCode => `${containers.types.path}/${typeCode}`

/** Starter approval types seeded (install-once, kept) into the types container. */
export const starterTypes = [
  ['APT-0001', 'Purchase approval', 'Spending above the purchase threshold needs sign-off before ordering.',
    2, { requiresAmount: true, requiresDate: true, requiresReference: false }, '8c2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e01'],
  ['APT-0002', 'Travel', 'Business travel is approved before anything is booked.',
    1, { requiresAmount: true, requiresDate: true, requiresReference: false }, '8c2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e02'],
  ['APT-0003', 'Contract sign-off', 'Contracts are reviewed and signed off against their reference before signature.',
    2, { requiresAmount: false, requiresDate: false, requiresReference: true }, '8c2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e03'],
].map(([typeCode, name, description, requiredApprovers, fields, id]) => ({
  $schema: schemaId('type'), schemaVersion: 1, kind: 'type', id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: typeCode, name, description, requiredApprovers, ...fields,
}))

/** A sample draft request seeded (install-once, kept) into the requests container. */
export const sampleRequest = {
  $schema: schemaId('request'), schemaVersion: 1, kind: 'request', id: '8c2d3e4f-5a6b-4c7d-9e8f-1a2b3c4d5e10',
  state: 'active', createdAt: seedTime, updatedAt: seedTime, code: 'APR-0001',
  type: typePath('APT-0001'), title: 'Two standing desks', requester: 'Alex Example',
  amount: '1250.00', date: '', reference: '', reason: 'The quote expires at the end of the month.',
  status: 'draft', approvals: [],
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultRequester: '',
}

export { fillTemplate }
