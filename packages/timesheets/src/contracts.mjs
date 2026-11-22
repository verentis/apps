// File-based Timesheets record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  decimal, fillTemplate, code, optional, optionalDate, pathOrEmpty, schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/timesheets'
export const schemaBase = 'https://schemas.verentis.io/timesheets/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the entries.
export const settingsPath = '/settings/timesheets.json'
/** Project (optional) keeps projects and tasks here; entries can reference the work they log time against. */
export const project = {
  projects: '/projects',
  tasks: '/tasks',
  projectMime: 'application/vnd.verentis.project.project+json',
  taskMime: 'application/vnd.verentis.project.task+json',
}

const vendor = kind => `application/vnd.verentis.timesheets.${kind}+json`

export const mimeTypes = {
  entries: 'application/vnd.verentis.timesheets.entries',
  entry: vendor('entry'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  entries: { path: '/timesheets', mime: mimeTypes.entries, holds: ['entry'] },
}

/** Records are named by a generated code (`TS-0001`) and stored without an extension in their container. */
export const recordKinds = ['entry']
export const containerOf = { entry: 'entries' }

export const codeSettings = {
  entry: { key: 'entry-code-prefix', default: 'TS-', label: 'Entry code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const entryStatuses = ['draft', 'validated']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Timesheets')
export { schemaId }

// Draft records may be incomplete on disk (a generated record opens straight into its form); validating checks them.
export const schemas = {
  entry: recordSchema('entry', 'timesheet entry', {
    code,
    employee: optional(200),
    date: optionalDate,
    project: pathOrEmpty,
    task: pathOrEmpty,
    // Hours are an exact decimal string ("7.5"), never a JSON number; empty while a draft is incomplete.
    hours: decimal,
    description: optional(10000),
    status: { enum: entryStatuses },
    validatedAt: timestamp,
  }, ['code', 'employee', 'date', 'project', 'task', 'hours', 'description', 'status'], [
    whenStatus(['validated'], ['validatedAt']),
  ]),
  settings: settingsSchema({
    employee: optional(200),
  }, ['employee']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the date and the employee from the settings.
 */
export const templates = {
  entry: recordTemplate('entry', {
    employee: '', date: '', project: '', task: '', hours: '', description: '{{ name }}', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  entry: { date: 'today', employee: { file: settingsPath, pointer: 'employee' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  employee: '',
}

export { fillTemplate }
