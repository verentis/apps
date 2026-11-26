// Generates the Employees Canvas documents: a bound form per record kind, the settings form, the launch page,
// the employee directory and the department summary. Terminating (status transition, termination date, locking)
// is done by the action script the employee form runs.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['active'], warning: ['on-leave'], danger: ['terminated'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Employees schemas and run the employee action script' }
const terminated = "form.values.status === 'terminated'"
const activeStatus = "form.values.status === 'active'"
const idle = 'form.saving || form.dirty'

const departmentSources = {
  departments: folder(containers.departments.path, mimeTypes.department),
  departmentoptions: { kind: 'computed', expr: options('departments', "e.data.name || ''") },
}
const departmentsAccess = reason => ({ path: containers.departments.path, reason })
const employeesAccess = reason => ({ path: containers.employees.path, reason })
const employeeSources = {
  staff: folder(containers.employees.path, mimeTypes.employee),
  employeeoptions: { kind: 'computed', expr: options('staff', "e.data.name || ''", "e.data.status !== 'terminated'") },
}

/** Kind-specific data, access, actions, header buttons, state and notices of a record form. */

// What this person has in the other HR and operations apps, matched by name. A section shows only when its app
// is installed (its folder exists); each record opens beside the profile.
const elsewhere = [
  { key: 'leave', title: 'Time off', path: '/leave-requests', mime: 'application/vnd.verentis.time-off.request+json', field: 'employee',
    item: { title: 'type', subtitle: ['startDate', 'endDate'], badge: 'status' }, map: "type: e.data.type || 'Leave', startDate: e.data.startDate, endDate: e.data.endDate, status: e.data.status" },
  { key: 'hours', title: 'Timesheets', path: '/timesheets', mime: 'application/vnd.verentis.timesheets.entry+json', field: 'employee',
    item: { title: 'date', subtitle: ['hours'], badge: 'status' }, map: "date: e.data.date, hours: (e.data.hours || '0') + ' h', status: e.data.status" },
  { key: 'reviews', title: 'Appraisals', path: '/appraisals', mime: 'application/vnd.verentis.appraisals.appraisal+json', field: 'employee',
    item: { title: 'period', subtitle: ['score'], badge: 'status' }, map: "period: e.data.period || e.data.code, score: e.data.overallScore ? 'Score ' + e.data.overallScore : '', status: e.data.status" },
  { key: 'shifts', title: 'Shifts', path: '/shifts', mime: 'application/vnd.verentis.planning.shift+json', field: 'employee',
    item: { title: 'date', subtitle: ['time'], badge: 'status' }, map: "date: e.data.date, time: [e.data.startTime, e.data.endTime].filter(t => t).join(' to '), status: e.data.status" },
  { key: 'tickets', title: 'Tickets', path: '/tickets', mime: 'application/vnd.verentis.helpdesk.ticket+json', field: 'assignee',
    item: { title: 'subject', subtitle: ['code'], badge: 'stage' }, map: "subject: e.data.subject || e.data.code, code: e.data.code, stage: e.data.stage" },
]
const elsewhereRows = app => `(data.${app.key} || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && String(e.data.${app.field} || '').trim().toLowerCase() === String(form.values.name || '').trim().toLowerCase()).map(e => ({ path: e.path, ${app.map} })).sort((a, b) => String(b.date || b.startDate || '') < String(a.date || a.startDate || '') ? -1 : 1)`
const elsewhereCards = () => grid(elsewhere.map(app => ({
  ...card(app.title, [{
    type: 'canvas.related',
    props: { rows: `{{ ${elsewhereRows(app)} }}`, item: app.item, limit: 5, emptyText: `Nothing in ${app.title} for this person` },
    on: { open: [openFile('{{ event.row.path }}', 'edit', 'side')], more: [openFile(app.path)] },
  }]),
  rules: { visible: `data.$${app.key}.status === 'ready'` },
})))

function recordExtras(kind) {
  if (kind === 'department') {
    return {
      access: [employeesAccess('Choose the employee who manages the department'), schemaAccess],
      data: employeeSources,
      notices: [], buttons: [], actions: {}, locked: 'false',
    }
  }
  return {
    access: [
      departmentsAccess('Choose the department an employee belongs to'),
      employeesAccess('Choose an employee\'s manager'),
      schemaAccess,
      ...elsewhere.map(app => ({ path: app.path, reason: `Show this person's ${app.title.toLowerCase()} (when that app is installed)` })),
    ],
    data: {
      ...departmentSources,
      ...employeeSources,
      ...Object.fromEntries(elsewhere.map(app => [app.key, { kind: 'folder', path: app.path, contents: true, 'mime-pattern': app.mime }])),
      manageroptions: { kind: 'computed', expr: options('staff', "e.data.name || ''", "e.data.status !== 'terminated'") },
    },
    state: { terminationdate: '' },
    notices: [
      { ...text('This employee was terminated on {{ form.values.terminationDate }} and can no longer be edited.', 'muted'),
        rules: { visible: terminated } },
      grid([
        { type: 'canvas.form.date', props: { label: 'Termination date', value: '{{ state.terminationdate }}',
          description: 'Used by Terminate; left empty it defaults to today.' }, rules: { visible: activeStatus } },
      ]),
    ],
    buttons: [
      button('Terminate', 'terminate', { visible: `${activeStatus} && !(${archived})`, disabled: idle }, 'outline', 'user-x'),
    ],
    actions: {
      terminate: scriptAction(postScriptPath, 'terminate', {
        confirm: { title: 'Terminate employee', message: 'Terminate this employee as of the termination date? Terminated employees are locked and can no longer be edited.' },
        parameters: { date: '{{ state.terminationdate }}' },
      }),
    },
    locked: terminated,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...extras.buttons, recordButtons(extras.locked)],
  )
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    archivedAlert(entity.singular),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
    ...(kind === 'employee' ? [elsewhereCards()] : []),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `employees-${kind}`, displayName: `Employees ${entity.singular.toLowerCase()}`,
      description: `View and edit an Employees ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, ...(extras.state ? { state: extras.state } : {}), tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'employees-settings', displayName: 'Employees settings', description: 'Edit the Employees settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [departmentsAccess('Choose the default department for new employees'), schemaAccess],
      data: departmentSources,
      tree: [
        pageHeader(
          [heading('Employees settings'), text('The default department for new employees. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('departments', `The ${containers.departments.path} folder could not be read. Reinstall Employees to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active employee flattened for the pages: department and manager paths and names, status and dates.
const employeeRows = `(data.staff || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', jobTitle: e.data.jobTitle || '', departmentPath: e.data.department || '', department: ((((data.departments || []).find(d => d.kind === 'file' && d.data && d.path === e.data.department) || {}).data || {}).name) || '', manager: ((((data.staff || []).find(m => m.kind === 'file' && m.data && m.path === e.data.manager) || {}).data || {}).name) || '', startDate: e.data.startDate || '', status: e.data.status || 'active', terminationDate: e.data.terminationDate || '' }))`
const pageSources = {
  staff: folder(containers.employees.path, mimeTypes.employee),
  departments: folder(containers.departments.path, mimeTypes.department),
  rows: { kind: 'computed', expr: employeeRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const directoryColumns = [['code', 'Employee'], ['name', 'Name'], ['jobTitle', 'Job title'], ['department', 'Department'],
  ['manager', 'Manager'], ['startDate', 'Start date'], ['status', 'Status']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'departments' ? 'departments' : 'staff', `The ${containers[name].path} folder could not be read. Reinstall Employees to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'employees-home', name: 'Employees', description: 'Employees overview.', icon: 'user-round' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count employees and show the departments and the directory'),
        data: pageSources,
        tree: page([
          pageHeader(
            [heading('Employees'), text('Departments and employees are files in your workspace. Keep the directory in /employees, organize it by department, and terminate employees from their forms.', 'muted')], [
            row([
              button('Directory', [openFile(`${installRoot}/canvas/directory.page.yaml`)], undefined, 'outline', 'users'),
              button('Departments', [openFile(`${installRoot}/canvas/departments.page.yaml`)], undefined, 'outline', 'building-2'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Active', countOf("r.status === 'active'"), 'user-round', loading('staff')),
            stat('On leave', countOf("r.status === 'on-leave'"), 'plane', loading('staff')),
            stat('Terminated', countOf("r.status === 'terminated'"), 'user-x', loading('staff')),
            stat('Departments', `{{ (data.departments || []).filter(e => ${active}).length }}`, 'building-2', loading('departments')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'employees', label: 'Employees', icon: 'user-round' },
            { value: 'departments', label: 'Departments', icon: 'building-2' },
          ], [
            panel('employees', [row([button('Open /employees', [openFile(containers.employees.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.employees.path, mimeTypes.employee, [{ key: 'name', label: 'Employee' }, { key: 'data.name', label: 'Name' },
                { key: 'data.jobTitle', label: 'Job title' }, { key: 'data.status', label: 'Status' },
                { key: 'data.startDate', label: 'Start date' }], `No employees yet. Use New in ${containers.employees.path}.`)]),
            panel('departments', [row([button('Open /departments', [openFile(containers.departments.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.departments.path, mimeTypes.department, [{ key: 'name', label: 'Department' },
                { key: 'data.name', label: 'Name' }], `No departments yet. Use New in ${containers.departments.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function directoryPage() {
  const rows = `{{ (data.rows || []).filter(r => state.showterminated || r.status !== 'terminated').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }}`
  return {
    file: 'directory.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'employees-directory', name: 'Directory', description: 'The employee directory.', icon: 'users' },
      spec: {
        access: pageAccess('List employees with their departments and managers'),
        data: pageSources,
        state: { showterminated: false },
        tree: page([
          pageHeader(
            [heading('Employee directory'), text('Every employee with their department, manager and status. Click a row to open the employee.', 'muted')], [
            button('Employees', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'user-round'),
          ]),
          ...containerNotices(),
          stats([
            stat('Active', countOf("r.status === 'active'"), 'user-round', loading('staff')),
            stat('On leave', countOf("r.status === 'on-leave'"), 'plane', loading('staff')),
            stat('Terminated', countOf("r.status === 'terminated'"), 'user-x', loading('staff')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show terminated employees', value: '{{ state.showterminated }}' } },
          table(rows, directoryColumns, 'No employees yet', true),
        ]),
      },
    },
  }
}

function departmentsPage() {
  const departmentRows = `{{ (data.departments || []).filter(d => d.kind === 'file' && d.data && d.data.state !== 'archived').map(d => ({ path: d.path, code: d.data.code || d.name, name: d.data.name || '', manager: ((((data.staff || []).find(m => m.kind === 'file' && m.data && m.path === d.data.manager) || {}).data || {}).name) || '', active: (data.rows || []).filter(r => r.departmentPath === d.path && r.status === 'active').length, onLeave: (data.rows || []).filter(r => r.departmentPath === d.path && r.status === 'on-leave').length, terminated: (data.rows || []).filter(r => r.departmentPath === d.path && r.status === 'terminated').length })) }}`
  const unassigned = `(data.rows || []).filter(r => !r.departmentPath && r.status !== 'terminated')`
  return {
    file: 'departments.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'employees-departments', name: 'Departments', description: 'Headcount per department.', icon: 'building-2' },
      spec: {
        access: pageAccess('Sum employees per department with their managers'),
        data: pageSources,
        tree: page([
          pageHeader(
            [heading('Departments'), text('Headcount per department: active and on-leave employees, with the department manager. Click a department to open it.', 'muted')], [
            button('Employees', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'user-round'),
          ]),
          ...containerNotices(),
          stats([
            stat('Departments', `{{ (data.departments || []).filter(e => ${active}).length }}`, 'building-2', loading('departments')),
            stat('Employed', countOf("r.status !== 'terminated'"), 'users', loading('staff')),
            stat('Without department', `{{ ${unassigned}.length }}`, 'user-round-search', loading('staff')),
          ], 3),
          card('Departments', [table(departmentRows, [['code', 'Department'], ['name', 'Name'], ['manager', 'Manager'],
            ['active', 'Active', 'end'], ['onLeave', 'On leave', 'end'], ['terminated', 'Terminated', 'end']], 'No departments yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), directoryPage(), departmentsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
