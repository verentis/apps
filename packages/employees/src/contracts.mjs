// File-based Employees record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  fillTemplate, code, optional, optionalDate, optionalEmail, pathOrEmpty, schemas as schemaKit, text, timestamp,
  whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/employees'
export const schemaBase = 'https://schemas.verentis.io/employees/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the people.
export const settingsPath = '/settings/employees.json'

const vendor = kind => `application/vnd.verentis.employees.${kind}+json`

export const mimeTypes = {
  departments: 'application/vnd.verentis.employees.departments',
  employees: 'application/vnd.verentis.employees.employees',
  department: vendor('department'),
  employee: vendor('employee'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  departments: { path: '/departments', mime: mimeTypes.departments, holds: ['department'] },
  employees: { path: '/employees', mime: mimeTypes.employees, holds: ['employee'] },
}

/** Records are named by a generated code (`EMP-0001`) and stored without an extension in their container. */
export const recordKinds = ['department', 'employee']
export const containerOf = { department: 'departments', employee: 'employees' }

export const codeSettings = {
  department: { key: 'department-code-prefix', default: 'DEP-', label: 'Department code prefix' },
  employee: { key: 'employee-code-prefix', default: 'EMP-', label: 'Employee number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Employment statuses. `terminated` is reached only through the Terminate script action. */
export const statuses = ['active', 'on-leave', 'terminated']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Employees')
export { schemaId }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  department: recordSchema('department', 'department', {
    code,
    name: text,
    manager: pathOrEmpty,
  }, ['code', 'name', 'manager']),
  employee: recordSchema('employee', 'employee', {
    code,
    name: text,
    jobTitle: optional(200),
    department: pathOrEmpty,
    manager: pathOrEmpty,
    workEmail: optionalEmail,
    workPhone: optional(50),
    startDate: optionalDate,
    status: { enum: statuses },
    terminationDate: optionalDate,
    terminatedAt: timestamp,
  }, ['code', 'name', 'jobTitle', 'department', 'manager', 'workEmail', 'workPhone', 'startDate', 'status'], [
    whenStatus(['terminated'], ['terminationDate', 'terminatedAt']),
  ]),
  settings: settingsSchema({
    defaultDepartment: pathOrEmpty,
  }, ['defaultDepartment']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code`, fills the department from settings and defaults the start date to today.
 */
export const templates = {
  department: recordTemplate('department', { name: '{{ name }}', manager: '' }),
  employee: recordTemplate('employee', {
    name: '{{ name }}', jobTitle: '', department: '', manager: '', workEmail: '', workPhone: '',
    startDate: '', status: 'active',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  department: {},
  employee: { department: { file: settingsPath, pointer: 'defaultDepartment' }, startDate: 'today' },
}

const seedTime = '2026-01-01T00:00:00Z'
const seedDepartmentPath = `${containers.departments.path}/DEP-0001`
const seedManagerPath = `${containers.employees.path}/EMP-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** A starter department and sample employees, seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('department', 'DEP-0001', '8d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f01', {
    name: 'Operations', manager: seedManagerPath,
  }),
  seedRecord('employee', 'EMP-0001', '8d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f02', {
    name: 'Avery Adams', jobTitle: 'Operations manager', department: seedDepartmentPath, manager: '',
    workEmail: 'avery.adams@example.com', workPhone: '+27 21 555 0101', startDate: '2023-02-01', status: 'active',
  }),
  seedRecord('employee', 'EMP-0002', '8d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f03', {
    name: 'Jordan Jacobs', jobTitle: 'Operations coordinator', department: seedDepartmentPath, manager: seedManagerPath,
    workEmail: 'jordan.jacobs@example.com', workPhone: '', startDate: '2024-06-15', status: 'active',
  }),
  seedRecord('employee', 'EMP-0003', '8d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f04', {
    name: 'Sam Senna', jobTitle: 'Facilities technician', department: seedDepartmentPath, manager: seedManagerPath,
    workEmail: 'sam.senna@example.com', workPhone: '', startDate: '2025-01-20', status: 'on-leave',
  }),
]
export const starterDepartment = starterRecords[0]
export const starterEmployees = starterRecords.filter(record => record.kind === 'employee')

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultDepartment: seedDepartmentPath,
}

export { fillTemplate }
