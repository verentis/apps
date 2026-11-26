// File-based Spreadsheet BI record contracts. Every record is one JSON file whose vendor MIME names its kind.
// Dashboards are saved pivot/tile definitions computed live from sibling apps' record containers; snapshots
// freeze one computation. Spreadsheet *editing* is the platform Office integration's job, not this app's.
import {
  array, code, fillTemplate, object, optional, pathOrEmpty, schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/spreadsheet-bi'
export const schemaBase = 'https://schemas.verentis.io/spreadsheet-bi/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the dashboards.
export const settingsPath = '/settings/spreadsheet-bi.json'

/** CRM (optional) keeps customers here; dashboards typically count them by type. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}
/** Invoicing (optional) keeps invoices here; dashboards typically sum issued invoice totals. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
}
/** Accounting (optional) keeps the ledger here; dashboards can group posted journals and expenses. */
export const accounting = {
  journals: '/journals',
  expenses: '/expenses',
  journalMime: 'application/vnd.verentis.accounting.journal+json',
  expenseMime: 'application/vnd.verentis.accounting.expense+json',
}
/** Helpdesk (optional) keeps tickets here; dashboards can count them by stage. */
export const helpdesk = {
  tickets: '/tickets',
  ticketMime: 'application/vnd.verentis.helpdesk.ticket+json',
}

/** The source container paths the viewer page and the snapshot script can read (all optional apps). */
export const sourceContainers = [crm.customers, invoicing.invoices, helpdesk.tickets, accounting.journals, accounting.expenses]

const vendor = kind => `application/vnd.verentis.spreadsheet-bi.${kind}+json`

export const mimeTypes = {
  dashboards: 'application/vnd.verentis.spreadsheet-bi.dashboards',
  snapshots: 'application/vnd.verentis.spreadsheet-bi.snapshots',
  dashboard: vendor('dashboard'),
  snapshot: vendor('snapshot'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  dashboards: { path: '/bi-dashboards', mime: mimeTypes.dashboards, holds: ['dashboard'] },
  snapshots: { path: '/bi-snapshots', mime: mimeTypes.snapshots, holds: ['snapshot'] },
}

/** Records are named by a generated code (`BID-0001`) and stored without an extension in their container. */
export const recordKinds = ['dashboard', 'snapshot']
export const containerOf = { dashboard: 'dashboards', snapshot: 'snapshots' }

export const codeSettings = {
  dashboard: { key: 'dashboard-code-prefix', default: 'BID-', label: 'Dashboard code prefix' },
  snapshot: { key: 'snapshot-code-prefix', default: 'BIS-', label: 'Snapshot code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** How a tile aggregates its source container's records. */
export const tileKinds = ['count', 'sum', 'group-count', 'group-sum']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Spreadsheet BI')
export { schemaId }

/** A dot-notation record field path (`totals.gross`); empty until needed. */
const fieldPath = { type: 'string', maxLength: 200, pattern: '^([A-Za-z0-9_$]+(\\.[A-Za-z0-9_$]+)*)?$' }
/** A tile or result ordinal kept as a digit string so forms can edit it in array rows. */
const sequence = { type: 'string', pattern: '^[0-9]{1,4}$' }
/** A computed tile value: a decimal string from BigInt math or a count. */
const computedValue = optional(64)

/**
 * One dashboard tile: an aggregation over the records of one source container. `valueField` names the summed
 * field (sum kinds), `groupByField` the grouping key (group kinds) and `filter` keeps only records whose field
 * equals a value.
 */
const tile = object({
  sequence,
  title: optional(200),
  source: pathOrEmpty,
  kind: { enum: tileKinds },
  valueField: fieldPath,
  groupByField: fieldPath,
  filter: object({ field: fieldPath, equals: optional(200) }, []),
}, ['sequence', 'title', 'source', 'kind', 'valueField', 'groupByField'])

/** One computed tile result in a snapshot: a single value or the groups of a group tile. */
const result = object({
  sequence,
  title: optional(200),
  value: computedValue,
  groups: array(object({ key: optional(200), value: computedValue }), 0, 500),
  note: optional(500),
}, ['sequence', 'title'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); taking checks them.
export const schemas = {
  dashboard: recordSchema('dashboard', 'dashboard', {
    code,
    name: optional(200),
    description: optional(10000),
    tiles: array(tile, 0, 100),
  }, ['code', 'name', 'description', 'tiles']),
  snapshot: recordSchema('snapshot', 'snapshot', {
    code,
    dashboard: pathOrEmpty,
    takenAt: timestamp,
    results: array(result, 0, 200),
    status: { enum: ['draft', 'taken'] },
  }, ['code', 'dashboard', 'results', 'status'], [
    whenStatus(['taken'], ['takenAt', 'results']),
  ]),
  settings: settingsSchema({
    defaultDashboard: pathOrEmpty,
  }, ['defaultDashboard']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills the snapshot's dashboard from the settings' default dashboard.
 */
export const templates = {
  dashboard: recordTemplate('dashboard', { name: '{{ name }}', description: '', tiles: [] }),
  snapshot: recordTemplate('snapshot', { dashboard: '', results: [], status: 'draft' }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  dashboard: {},
  snapshot: { dashboard: { file: settingsPath, pointer: 'defaultDashboard' } },
}

const seedTime = '2026-01-01T00:00:00Z'
export const seedDashboardPath = `${containers.dashboards.path}/BID-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/**
 * A sample dashboard, seeded once so the viewer has something to show: CRM customers grouped by their `type`
 * and the gross total of issued Invoicing invoices (both optional apps; tiles skip with a note when absent).
 */
export const starterRecords = [
  seedRecord('dashboard', 'BID-0001', '6b2e4f1a-3c5d-4e7f-9a0b-1c2d3e4f5a01', {
    name: 'Sales overview',
    description: 'Customers by type from CRM and issued invoice revenue from Invoicing.',
    tiles: [
      { sequence: '1', title: 'Customers by type', source: crm.customers, kind: 'group-count',
        valueField: '', groupByField: 'type', filter: { field: '', equals: '' } },
      { sequence: '2', title: 'Issued invoice revenue', source: invoicing.invoices, kind: 'sum',
        valueField: 'totals.gross', groupByField: '', filter: { field: 'status', equals: 'issued' } },
    ],
  }),
]

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultDashboard: seedDashboardPath,
}

export { fillTemplate }
