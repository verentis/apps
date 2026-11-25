// Generates the Planning Canvas documents: bound forms for roles and shifts, the settings form, the launch page,
// the week schedule summary and the shift list by status. Publishing (overlap check) and confirming (locking)
// are done by the action script the shift form runs.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, employees, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, statuses } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['confirmed'], warning: ['published'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Planning schemas and run the shift action script' }
const locked = "form.values.status === 'confirmed'"
const idle = 'form.saving || form.dirty'

const roleSources = {
  roles: folder(containers.roles.path, mimeTypes.role),
  roleoptions: { kind: 'computed', expr: options('roles', "e.data.name || ''") },
}
const rolesAccess = reason => ({ path: containers.roles.path, reason })

const copyName = `(((data.people || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.employeeRef).map(e => e.data.name || '')[0]) || form.values.employee)`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'role') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [
      rolesAccess('Choose the role a shift is planned for'),
      { path: employees.employees, reason: 'Offer employees on shifts (when Employees is installed)' },
      schemaAccess,
    ],
    data: {
      ...roleSources,
      people: folder(employees.employees, employees.employeeMime),
      employeeoptions: { kind: 'computed', expr: options('people', "e.data.name || ''") },
    },
    notices: [
      { ...text('This shift is confirmed and can no longer be edited.', 'muted'), rules: { visible: locked } },
    ],
    buttons: [
      button('Publish', 'publish', { visible: `form.values.status === 'draft' && !(${archived})`,
        disabled: `${idle} || !form.values.date || !form.values.startTime || !form.values.endTime || !String(form.values.employee || '').trim()` }, undefined, 'send'),
      button('Confirm', 'confirm', { visible: `form.values.status === 'published' && !(${archived})`, disabled: idle }, undefined, 'lock'),
      button('Copy name', 'copy-employee', { visible: `!(${locked}) && !!form.values.employeeRef`, disabled: `form.saving || ${archived}` }, 'ghost', 'copy'),
    ],
    actions: {
      'copy-employee': { steps: [{ 'patch-form': { values: { employee: `{{ ${copyName} }}` } } }] },
      publish: scriptAction(postScriptPath, 'publish', {
        confirm: { title: 'Publish shift', message: 'Publish this shift? The employee\'s schedule is checked for overlapping published or confirmed shifts.' },
      }),
      confirm: scriptAction(postScriptPath, 'confirm', {
        confirm: { title: 'Confirm shift', message: 'Confirm this published shift? Confirmed shifts are locked and cannot be edited.' },
      }),
    },
    locked,
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
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `planning-${kind}`, displayName: `Planning ${entity.singular.toLowerCase()}`,
      description: `View and edit a Planning ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'planning-settings', displayName: 'Planning settings', description: 'Edit the Planning settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [rolesAccess('Choose the default role for new shifts'), schemaAccess],
      data: roleSources,
      tree: [
        pageHeader(
          [heading('Planning settings'), text('The default role for new shifts. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('roles', `The ${containers.roles.path} folder could not be read. Reinstall Planning to recreate it.`),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active shift flattened for the pages: date, employee, role name, times and status.
const shiftRows = `(data.shifts || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employee || '', role: ((((data.roles || []).find(r => r.kind === 'file' && r.data && r.path === e.data.role) || {}).data || {}).name) || '', date: e.data.date || '', start: e.data.startTime || '', end: e.data.endTime || '', time: [e.data.startTime, e.data.endTime].filter(Boolean).join('–'), status: e.data.status || '' }))`
const shiftSources = {
  shifts: folder(containers.shifts.path, mimeTypes.shift),
  roles: folder(containers.roles.path, mimeTypes.role),
  rows: { kind: 'computed', expr: shiftRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value[0].toUpperCase() + value.slice(1)
const shiftColumns = [['code', 'Shift'], ['employee', 'Employee'], ['role', 'Role'], ['date', 'Date'], ['time', 'Time'], ['status', 'Status']]

const containerNotices = () => [
  status('shifts', `The ${containers.shifts.path} folder could not be read. Reinstall Planning to recreate it.`)[0],
  status('roles', `The ${containers.roles.path} folder could not be read. Reinstall Planning to recreate it.`)[0],
]

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'planning-home', name: 'Planning', description: 'Planning overview.', icon: 'calendar-days' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count shifts and show the roles and shifts'),
        data: shiftSources,
        tree: page([
          pageHeader(
            [heading('Planning'), text('Shift roles and shifts are files in your workspace. Draft shifts in /shifts, publish them overlap-checked, then confirm them from their forms.', 'muted')], [
            row([
              button('Week schedule', [openFile(`${installRoot}/canvas/week.page.yaml`)], undefined, 'outline', 'calendar-days'),
              button('Shifts', [openFile(`${installRoot}/canvas/shifts.page.yaml`)], undefined, 'outline', 'list'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Shifts', countOf('true'), 'calendar-days', loading('shifts')),
            stat('Draft', countOf("r.status === 'draft'"), 'pencil', loading('shifts')),
            stat('Published', countOf("r.status === 'published'"), 'send', loading('shifts')),
            stat('Confirmed', countOf("r.status === 'confirmed'"), 'lock', loading('shifts')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'shifts', label: 'Shifts', icon: 'calendar-days' },
            { value: 'roles', label: 'Roles', icon: 'tags' },
          ], [
            panel('shifts', [row([button('Open /shifts', [openFile(containers.shifts.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.shifts.path, mimeTypes.shift, [{ key: 'name', label: 'Shift' }, { key: 'data.employee', label: 'Employee' },
                { key: 'data.date', label: 'Date' }, { key: 'data.startTime', label: 'Start' }, { key: 'data.endTime', label: 'End' },
                { key: 'data.status', label: 'Status' }], `No shifts yet. Use New in ${containers.shifts.path}.`)]),
            panel('roles', [row([button('Open /shift-roles', [openFile(containers.roles.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.roles.path, mimeTypes.role, [{ key: 'name', label: 'Role' }, { key: 'data.name', label: 'Name' },
                { key: 'data.color', label: 'Color' }], `No roles yet. Use New in ${containers.roles.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function weekPage() {
  const week = `(data.rows || []).filter(r => !!r.date && r.date >= Date().slice(0, 10) && r.date < Date(Date.now() + 7 * 86400000).slice(0, 10))`
  const weekRows = `{{ ${week}.sort((a, b) => ((a.date + (a.start || '~') + a.employee) < (b.date + (b.start || '~') + b.employee) ? -1 : 1)) }}`
  const dayRows = `{{ ${week}.map(r => r.date).filter((v, i, a) => a.indexOf(v) === i).sort().map(d => ({ date: d, shifts: ${week}.filter(r => r.date === d).length, employees: ${week}.filter(r => r.date === d).map(r => r.employee || 'Unassigned').filter((v, i, a) => a.indexOf(v) === i).length, confirmed: ${week}.filter(r => r.date === d && r.status === 'confirmed').length })) }}`
  const employeeRows = `{{ ${week}.map(r => r.employee || 'Unassigned').filter((v, i, a) => a.indexOf(v) === i).sort().map(e => ({ employee: e, shifts: ${week}.filter(r => (r.employee || 'Unassigned') === e).length, published: ${week}.filter(r => (r.employee || 'Unassigned') === e && r.status !== 'draft').length })) }}`
  return {
    file: 'week.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'planning-week', name: 'Week schedule', description: 'The next seven days of shifts, grouped by date and employee.', icon: 'calendar-days' },
      spec: {
        access: pageAccess('Summarise the coming week\'s shifts by date and employee'),
        data: shiftSources,
        tree: page([
          pageHeader(
            [heading('Week schedule'), text('Shifts in the next seven days, grouped by date and employee. Click a shift to open it.', 'muted')], [
            button('Planning', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-days'),
          ]),
          ...containerNotices(),
          stats([
            stat('Shifts this week', `{{ ${week}.length }}`, 'calendar-days', loading('shifts')),
            stat('Draft', `{{ ${week}.filter(r => r.status === 'draft').length }}`, 'pencil', loading('shifts')),
            stat('Published', `{{ ${week}.filter(r => r.status === 'published').length }}`, 'send', loading('shifts')),
            stat('Confirmed', `{{ ${week}.filter(r => r.status === 'confirmed').length }}`, 'lock', loading('shifts')),
          ]),
          card('By date', [table(dayRows, [['date', 'Date'], ['shifts', 'Shifts', 'end'], ['employees', 'Employees', 'end'], ['confirmed', 'Confirmed', 'end']], 'No shifts this week')]),
          card('By employee', [table(employeeRows, [['employee', 'Employee'], ['shifts', 'Shifts', 'end'], ['published', 'Published or confirmed', 'end']], 'No shifts this week')]),
          card('Week list', [table(weekRows, shiftColumns, 'No shifts this week', true)]),
        ]),
      },
    },
  }
}

function shiftsPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}').sort((a, b) => ((a.date + (a.start || '~')) < (b.date + (b.start || '~')) ? -1 : 1)) }}`,
    shiftColumns, `No ${value} shifts`, true)
  return {
    file: 'shifts.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'planning-shifts', name: 'Shifts', description: 'Every shift, listed by status.', icon: 'list' },
      spec: {
        access: pageAccess('List shifts by status with their role names'),
        data: shiftSources,
        tree: page([
          pageHeader(
            [heading('Shifts by status'), text('Every active shift, grouped by its status. Click a row to open the shift.', 'muted')], [
            button('Planning', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-days'),
          ]),
          ...containerNotices(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'calendar-days', loading('shifts'))), 3),
          tabs(statuses.map(value => ({ value, label: statusLabel(value), icon: 'calendar-days' })),
            statuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), weekPage(), shiftsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
