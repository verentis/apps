// File-based Project record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, optional, optionalDate, pathOrEmpty, requires, schemas as schemaKit, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/project'
export const schemaBase = 'https://schemas.verentis.io/project/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the projects.
export const settingsPath = '/settings/project.json'
/** CRM (optional) keeps customers here; a project can reference the customer it is for. */
export const crm = {
  customers: '/customers',
  companyMime: 'application/vnd.verentis.crm.company+json',
  contactMime: 'application/vnd.verentis.crm.contact+json',
}

const vendor = kind => `application/vnd.verentis.project.${kind}+json`

export const mimeTypes = {
  projects: 'application/vnd.verentis.project.projects',
  tasks: 'application/vnd.verentis.project.tasks',
  project: vendor('project'),
  task: vendor('task'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  projects: { path: '/projects', mime: mimeTypes.projects, holds: ['project'] },
  tasks: { path: '/tasks', mime: mimeTypes.tasks, holds: ['task'] },
}

/** Records are named by a generated code (`PROJ-0001`) and stored without an extension in their container. */
export const recordKinds = ['project', 'task']
export const containerOf = { project: 'projects', task: 'tasks' }

export const codeSettings = {
  project: { key: 'project-code-prefix', default: 'PROJ-', label: 'Project code prefix' },
  task: { key: 'task-code-prefix', default: 'TASK-', label: 'Task code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const projectStatuses = ['active', 'on-hold', 'done']
export const taskStages = ['backlog', 'in-progress', 'review', 'done']
export const taskPriorities = ['low', 'medium', 'high', 'urgent']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Project')
export { schemaId }

// Draft records may be incomplete on disk (a generated record opens straight into its form).
export const schemas = {
  project: recordSchema('project', 'project', {
    code,
    name: optional(200),
    customerRef: pathOrEmpty,
    status: { enum: projectStatuses },
    description: optional(10000),
  }, ['code', 'name', 'customerRef', 'status', 'description']),
  task: recordSchema('task', 'task', {
    code,
    project: pathOrEmpty,
    title: optional(200),
    stage: { enum: taskStages },
    priority: { enum: taskPriorities },
    assignee: optional(200),
    dueDate: optionalDate,
    description: optional(10000),
    completedAt: timestamp,
  }, ['code', 'project', 'title', 'stage', 'priority', 'assignee', 'dueDate', 'description'], [
    // Completing a task (the complete-task script) stamps when it was done.
    { if: { properties: { stage: { const: 'done' } }, required: ['stage'] }, then: requires(['completedAt']) },
  ]),
  settings: settingsSchema({
    defaultAssignee: optional(200),
  }, ['defaultAssignee']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills empty fields from the settings.
 */
export const templates = {
  project: recordTemplate('project', { name: '{{ name }}', customerRef: '', status: 'active', description: '' }),
  task: recordTemplate('task', {
    project: '', title: '{{ name }}', stage: 'backlog', priority: 'medium', assignee: '', dueDate: '', description: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  project: {},
  task: { assignee: { file: settingsPath, pointer: 'defaultAssignee' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultAssignee: '',
}

export { fillTemplate }
