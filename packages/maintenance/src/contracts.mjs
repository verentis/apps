// File-based Maintenance record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, decimal, fillTemplate, optional, optionalDate, pathOrEmpty, requires, schemas as schemaKit, text,
  timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/maintenance'
export const schemaBase = 'https://schemas.verentis.io/maintenance/v1'

const vendor = kind => `application/vnd.verentis.maintenance.${kind}+json`

export const mimeTypes = {
  equipments: 'application/vnd.verentis.maintenance.equipments',
  requests: 'application/vnd.verentis.maintenance.requests',
  equipment: vendor('equipment'),
  request: vendor('request'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  equipments: { path: '/equipment', mime: mimeTypes.equipments, holds: ['equipment'] },
  requests: { path: '/maintenance-requests', mime: mimeTypes.requests, holds: ['request'] },
}

/** Records are named by a generated code (`MREQ-0001`) and stored without an extension in their container. */
export const recordKinds = ['equipment', 'request']
export const containerOf = { equipment: 'equipments', request: 'requests' }

export const codeSettings = {
  equipment: { key: 'equipment-code-prefix', default: 'EQP-', label: 'Equipment code prefix' },
  request: { key: 'request-code-prefix', default: 'MREQ-', label: 'Maintenance request number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Equipment status is synchronised by the request actions: start, complete and scrap flip it. */
export const equipmentStatuses = ['operational', 'under-maintenance', 'scrapped']
export const requestTypes = ['corrective', 'preventive']
export const priorities = ['low', 'normal', 'high']
/** Request stages. `in-progress`, `repaired` and `scrap` are reached only through the script actions. */
export const requestStages = ['new', 'in-progress', 'repaired', 'scrap']
export const openStages = ['new', 'in-progress']

const { schemaId, recordSchema, recordTemplate } = schemaKit(schemaBase, 'Maintenance')
export { schemaId }

/** `if stage is X then fields are required`. */
const whenStage = (values, fields) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then: requires(fields),
})

// Name fields may be empty on disk: a generated record opens straight into its form, which requires them.
// Duration hours is an exact decimal string ("1.5"), never a JSON number.
export const schemas = {
  equipment: recordSchema('equipment', 'equipment', {
    code,
    name: text,
    category: optional(200),
    serial: optional(200),
    location: optional(200),
    assignedTo: optional(200),
    status: { enum: equipmentStatuses },
    purchaseDate: optionalDate,
    warrantyEnd: optionalDate,
  }, ['code', 'name', 'category', 'serial', 'location', 'assignedTo', 'status', 'purchaseDate', 'warrantyEnd']),
  request: recordSchema('request', 'maintenance request', {
    code,
    equipment: pathOrEmpty,
    type: { enum: requestTypes },
    priority: { enum: priorities },
    description: optional(10000),
    stage: { enum: requestStages },
    scheduledDate: optionalDate,
    durationHours: decimal,
    startedAt: timestamp,
    completedAt: timestamp,
    scrappedAt: timestamp,
  }, ['code', 'equipment', 'type', 'priority', 'description', 'stage', 'scheduledDate', 'durationHours'], [
    whenStage(['in-progress', 'repaired'], ['startedAt']),
    whenStage(['repaired'], ['completedAt']),
    whenStage(['scrap'], ['scrappedAt']),
  ]),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills an empty scheduled date with today.
 */
export const templates = {
  equipment: recordTemplate('equipment', {
    name: '{{ name }}', category: '', serial: '', location: '', assignedTo: '',
    status: 'operational', purchaseDate: '', warrantyEnd: '',
  }),
  request: recordTemplate('request', {
    equipment: '', type: 'corrective', priority: 'normal', description: '', stage: 'new',
    scheduledDate: '', durationHours: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  request: { scheduledDate: 'today' },
}

export { fillTemplate }
