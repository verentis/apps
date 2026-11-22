// File-based Field Service record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, decimal, fillTemplate, money, object, optional, optionalDate, pathOrEmpty, requires,
  schemas as schemaKit, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/field-service'
export const schemaBase = 'https://schemas.verentis.io/field-service/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the tasks.
export const settingsPath = '/settings/field-service.json'
/** CRM (optional) keeps customers here; field tasks can reference a customer and copy its name. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}
/** Invoicing (optional) keeps invoices here; completing a task can draft an invoice for the work done. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchemaId: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
}

const vendor = kind => `application/vnd.verentis.field-service.${kind}+json`

export const mimeTypes = {
  tasks: 'application/vnd.verentis.field-service.tasks',
  task: vendor('task'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  tasks: { path: '/field-tasks', mime: mimeTypes.tasks, holds: ['task'] },
}

/** Records are named by a generated code (`FST-0001`) and stored without an extension in their container. */
export const recordKinds = ['task']
export const containerOf = { task: 'tasks' }

export const codeSettings = {
  task: { key: 'task-code-prefix', default: 'FST-', label: 'Task number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const taskTypes = ['install', 'repair', 'inspection']
/** Task stages. `scheduled`, `on-site`, `done` and `cancelled` are reached only through the script actions. */
export const stages = ['new', 'scheduled', 'on-site', 'done', 'cancelled']
export const openStages = ['new', 'scheduled', 'on-site']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Field Service')
export { schemaId }

/** A time of day (`08:30`), empty while a draft is incomplete. */
export const optionalTime = { type: 'string', pattern: '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' }

/** `if stage is X then fields are required`. */
const whenStage = (values, fields) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then: requires(fields),
})

/** A material used on site. Quantity and unit price are exact decimal strings, never JSON numbers. */
export const material = object({
  description: optional(500),
  quantity: decimal,
  unitPrice: money,
}, ['description', 'quantity', 'unitPrice'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); the actions check them.
export const schemas = {
  task: recordSchema('task', 'field task', {
    code,
    customerName: optional(200),
    customerRef: pathOrEmpty,
    address: optional(500),
    scheduledDate: optionalDate,
    windowStart: optionalTime,
    windowEnd: optionalTime,
    technician: optional(200),
    type: { enum: taskTypes },
    stage: { enum: stages },
    workLog: optional(10000),
    // Hours spent on site are an exact decimal string ("2.5"), never a JSON number.
    hours: decimal,
    materials: array(material, 0, 200),
    materialsTotal: money,
    invoice: pathOrEmpty,
    completedAt: timestamp,
    cancelledAt: timestamp,
  }, ['code', 'customerName', 'address', 'scheduledDate', 'windowStart', 'windowEnd', 'technician', 'type',
    'stage', 'workLog', 'hours', 'materials', 'materialsTotal'], [
    whenStage(['done'], ['completedAt']),
    whenStage(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    defaultTechnician: optional(200),
  }, ['defaultTechnician']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the technician from the settings.
 */
export const templates = {
  task: recordTemplate('task', {
    customerName: '{{ name }}', customerRef: '', address: '', scheduledDate: '', windowStart: '', windowEnd: '',
    technician: '', type: 'install', stage: 'new', workLog: '', hours: '', materials: [], materialsTotal: '',
    invoice: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  task: { technician: { file: settingsPath, pointer: 'defaultTechnician' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultTechnician: '',
}

export { fillTemplate }
