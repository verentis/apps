// File-based Helpdesk record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fillTemplate, optional, pathOrEmpty, requires, schemas as schemaKit, text, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/helpdesk'
export const schemaBase = 'https://schemas.verentis.io/helpdesk/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the tickets.
export const settingsPath = '/settings/helpdesk.json'
/** CRM (optional) keeps customers here; tickets can reference a customer and copy its name. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}

const vendor = kind => `application/vnd.verentis.helpdesk.${kind}+json`

export const mimeTypes = {
  teams: 'application/vnd.verentis.helpdesk.teams',
  tickets: 'application/vnd.verentis.helpdesk.tickets',
  team: vendor('team'),
  ticket: vendor('ticket'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  teams: { path: '/helpdesk-teams', mime: mimeTypes.teams, holds: ['team'] },
  tickets: { path: '/tickets', mime: mimeTypes.tickets, holds: ['ticket'] },
}

/** Records are named by a generated code (`TKT-0001`) and stored without an extension in their container. */
export const recordKinds = ['team', 'ticket']
export const containerOf = { team: 'teams', ticket: 'tickets' }

export const codeSettings = {
  team: { key: 'team-code-prefix', default: 'TEAM-', label: 'Team code prefix' },
  ticket: { key: 'ticket-code-prefix', default: 'TKT-', label: 'Ticket number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const priorities = ['low', 'normal', 'high', 'urgent']
/** Ticket stages. `solved` and `closed` are reached only through the resolve and close script actions. */
export const stages = ['new', 'in-progress', 'waiting', 'solved', 'closed']
export const openStages = ['new', 'in-progress', 'waiting']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Helpdesk')
export { schemaId }

/** A UTC timestamp that may be empty while a draft is incomplete (`slaDeadline` before a team is chosen). */
const optionalTimestamp = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z)?$' }

/** `if stage is X then fields are required`. */
const whenStage = (values, fields) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then: requires(fields),
})

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  team: recordSchema('team', 'team', {
    code,
    name: text,
    members: array({ type: 'string', maxLength: 200 }, 0, 100),
    slaHours: { type: 'integer', minimum: 1, maximum: 8760 },
  }, ['code', 'name', 'members', 'slaHours']),
  ticket: recordSchema('ticket', 'ticket', {
    code,
    team: pathOrEmpty,
    subject: text,
    customerRef: pathOrEmpty,
    customerName: optional(200),
    priority: { enum: priorities },
    stage: { enum: stages },
    slaDeadline: optionalTimestamp,
    assignee: optional(200),
    // The assignee's Employees record; empty when they are named only (Employees not installed).
    assigneeRef: pathOrEmpty,
    description: optional(10000),
    resolution: optional(10000),
    resolvedAt: timestamp,
    closedAt: timestamp,
  }, ['code', 'subject', 'priority', 'stage'], [
    whenStage(['solved', 'closed'], ['resolution', 'resolvedAt']),
    whenStage(['closed'], ['closedAt']),
  ]),
  settings: settingsSchema({
    defaultTeam: pathOrEmpty,
  }, ['defaultTeam']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code`, fills the team from settings and computes the SLA deadline from the team's SLA hours.
 */
export const templates = {
  team: recordTemplate('team', { name: '{{ name }}', members: [], slaHours: 24 }),
  ticket: recordTemplate('ticket', {
    team: '', subject: '{{ name }}', customerRef: '', customerName: '', priority: 'normal', stage: 'new',
    slaDeadline: '', assignee: '', assigneeRef: '', description: '', resolution: '',
  }),
}

/** Defaults the create script fills into empty template fields; the SLA deadline follows from the team. */
export const createDefaults = {
  team: {},
  ticket: { team: { file: settingsPath, pointer: 'defaultTeam' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const seedTeamPath = `${containers.teams.path}/TEAM-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** A starter team and sample tickets, seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('team', 'TEAM-0001', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e01', {
    name: 'Customer care', members: ['Avery Adams', 'Jordan Jacobs'], slaHours: 24,
  }),
  seedRecord('ticket', 'TKT-0001', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e02', {
    team: seedTeamPath, subject: 'Cannot sign in', customerRef: '', customerName: 'Globex',
    priority: 'high', stage: 'new', slaDeadline: '2026-01-02T00:00:00Z', assignee: '',
    description: 'Password reset emails never arrive.', resolution: '',
  }),
  seedRecord('ticket', 'TKT-0002', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e03', {
    team: seedTeamPath, subject: 'Invoice totals look wrong', customerRef: '', customerName: 'Initech',
    priority: 'normal', stage: 'in-progress', slaDeadline: '2026-01-02T00:00:00Z', assignee: 'Avery Adams',
    description: 'The March invoice is missing a credit.', resolution: '',
  }),
  seedRecord('ticket', 'TKT-0003', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e04', {
    team: seedTeamPath, subject: 'Export to spreadsheet', customerRef: '', customerName: 'Hooli',
    priority: 'low', stage: 'waiting', slaDeadline: '2026-01-02T00:00:00Z', assignee: 'Jordan Jacobs',
    description: 'Waiting for the customer to confirm the columns they need.', resolution: '',
  }),
]
export const starterTickets = starterRecords.filter(record => record.kind === 'ticket')
export const starterTeam = starterRecords[0]

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultTeam: seedTeamPath,
}

export { fillTemplate }
