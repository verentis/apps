// File-based Planning record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, optional, optionalDate, pathOrEmpty, requires, schemas as schemaKit, text, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/planning'
export const schemaBase = 'https://schemas.verentis.io/planning/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the shifts.
export const settingsPath = '/settings/planning.json'
/** Employees (optional) keeps employees here; shifts can reference an employee and copy its name. */
export const employees = {
  employees: '/employees',
  employeeMime: 'application/vnd.verentis.employees.employee+json',
}

const vendor = kind => `application/vnd.verentis.planning.${kind}+json`

export const mimeTypes = {
  roles: 'application/vnd.verentis.planning.roles',
  shifts: 'application/vnd.verentis.planning.shifts',
  role: vendor('role'),
  shift: vendor('shift'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  roles: { path: '/shift-roles', mime: mimeTypes.roles, holds: ['role'] },
  shifts: { path: '/shifts', mime: mimeTypes.shifts, holds: ['shift'] },
}

/** Records are named by a generated code (`SHF-0001`) and stored without an extension in their container. */
export const recordKinds = ['role', 'shift']
export const containerOf = { role: 'roles', shift: 'shifts' }

export const codeSettings = {
  role: { key: 'role-code-prefix', default: 'PLR-', label: 'Role code prefix' },
  shift: { key: 'shift-code-prefix', default: 'SHF-', label: 'Shift code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Shift statuses. `published` and `confirmed` are reached only through the publish and confirm script actions. */
export const statuses = ['draft', 'published', 'confirmed']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Planning')
export { schemaId }

/** A time of day (`08:30`), empty while a draft is incomplete. */
export const optionalTime = { type: 'string', pattern: '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' }

/** `if status is X then fields are required`. */
const whenStatus = (values, fields) => ({
  if: { properties: { status: { enum: values } }, required: ['status'] },
  then: requires(fields),
})

// Draft records may be incomplete on disk (a generated record opens straight into its form); publishing checks them.
export const schemas = {
  role: recordSchema('role', 'shift role', {
    code,
    name: text,
    color: optional(50),
    notes: optional(1000),
  }, ['code', 'name', 'color', 'notes']),
  shift: recordSchema('shift', 'shift', {
    code,
    employee: optional(200),
    employeeRef: pathOrEmpty,
    role: pathOrEmpty,
    date: optionalDate,
    startTime: optionalTime,
    endTime: optionalTime,
    status: { enum: statuses },
    notes: optional(10000),
    publishedAt: timestamp,
    confirmedAt: timestamp,
  }, ['code', 'employee', 'employeeRef', 'role', 'date', 'startTime', 'endTime', 'status', 'notes'], [
    whenStatus(['published', 'confirmed'], ['publishedAt']),
    whenStatus(['confirmed'], ['confirmedAt']),
  ]),
  settings: settingsSchema({
    defaultRole: pathOrEmpty,
  }, ['defaultRole']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the date and the default role from the settings.
 */
export const templates = {
  role: recordTemplate('role', { name: '{{ name }}', color: '', notes: '' }),
  shift: recordTemplate('shift', {
    employee: '{{ name }}', employeeRef: '', role: '', date: '', startTime: '', endTime: '', status: 'draft', notes: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  role: {},
  shift: { date: 'today', role: { file: settingsPath, pointer: 'defaultRole' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultRole: '',
}

export { fillTemplate }
