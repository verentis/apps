// File-based Appraisals record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, decimal, fillTemplate, object, optional, optionalDate, pathOrEmpty, requires,
  schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/appraisals'
export const schemaBase = 'https://schemas.verentis.io/appraisals/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the appraisals.
export const settingsPath = '/settings/appraisals.json'
/** Employees (optional) keeps employee records here; appraisals can reference one and copy its name. */
export const employees = {
  container: '/employees',
  employeeMime: 'application/vnd.verentis.employees.employee+json',
}

const vendor = kind => `application/vnd.verentis.appraisals.${kind}+json`

export const mimeTypes = {
  appraisals: 'application/vnd.verentis.appraisals.appraisals',
  appraisal: vendor('appraisal'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  appraisals: { path: '/appraisals', mime: mimeTypes.appraisals, holds: ['appraisal'] },
}

/** Records are named by a generated code (`APR-0001`) and stored without an extension in their container. */
export const recordKinds = ['appraisal']
export const containerOf = { appraisal: 'appraisals' }

export const codeSettings = {
  appraisal: { key: 'appraisal-code-prefix', default: 'APR-', label: 'Appraisal number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Appraisal statuses. `scheduled` and `done` are reached only through the schedule and complete script actions. */
export const statuses = ['draft', 'scheduled', 'done', 'cancelled']
export const scores = ['1', '2', '3', '4', '5']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Appraisals')
export { schemaId }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  appraisal: recordSchema('appraisal', 'appraisal', {
    code,
    employeeName: text,
    employeeRef: pathOrEmpty,
    period: optional(100),
    manager: optional(200),
    status: { enum: statuses },
    scheduledAt: optionalDate,
    ratings: array(object({ criteria: { type: 'string', maxLength: 200 }, score: { enum: scores } }), 0, 50),
    overallScore: decimal,
    summary: optional(10000),
    completedAt: timestamp,
    cancelledAt: timestamp,
  }, ['code', 'employeeName', 'status', 'scheduledAt', 'ratings', 'overallScore'], [
    whenStatus(['done'], ['completedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    defaultManager: optional(200),
  }, ['defaultManager']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and defaults the manager from the Appraisals settings.
 */
export const templates = {
  appraisal: recordTemplate('appraisal', {
    employeeName: '{{ name }}', employeeRef: '', period: '', manager: '', status: 'draft', scheduledAt: '',
    ratings: [], overallScore: '', summary: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  appraisal: { manager: { file: settingsPath, pointer: 'defaultManager' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultManager: '',
}

export { fillTemplate }
