// Generates the Time Off Canvas documents: a bound form per record kind, the settings form, the launch page,
// the request list by status and the remaining-allocation summary. Submitting, approving and refusing (weekday
// counts, approvals, locking) are done by the action script the request form runs.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, employees, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, statuses } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['approved'], warning: ['draft'], danger: ['refused'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Time Off schemas and run the request action script' }
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"
const submitted = "form.values.status === 'submitted'"

const typeSources = {
  types: folder(containers.types.path, mimeTypes.type),
  typeoptions: { kind: 'computed', expr: options('types', "e.data.name || ''") },
}
const typesAccess = reason => ({ path: containers.types.path, reason })
const copyName = `(((data.staff || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.employeeRef).map(e => e.data.name || '')[0]) || form.values.employeeName)`

/** Bound form controls; `switch` is a local extension for boolean fields. */
function control(field, readOnly) {
  if (field.type !== 'switch') return formControl(field, readOnly)
  return {
    type: 'canvas.form.switch',
    props: { label: field.label, value: `{{ form.values.${field.key} }}`, ...(field.description ? { description: field.description } : {}) },
    ...(field.span === 2 ? { layout: { tablet: { colSpan: 2 } } } : {}),
    ...(readOnly ? { rules: { disabled: readOnly } } : {}),
  }
}
const sectionCards = (sections, readOnly) =>
  sections.map(section => card(section.title, [grid(section.fields.map(field => control(field, readOnly)))], section.description))

/** Kind-specific data, access, actions, header buttons, state and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'type') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  const visibleWhenSubmitted = { visible: submitted }
  return {
    access: [
      typesAccess('Choose the leave type a request draws on'),
      { path: employees.directory, reason: 'Offer Employees records on requests (when Employees is installed)' },
      schemaAccess,
    ],
    data: {
      ...typeSources,
      staff: folder(employees.directory, employees.employeeMime),
      employeeoptions: { kind: 'computed', expr: options('staff', "e.data.name || ''", "e.data.status !== 'terminated'") },
    },
    state: { approver: '', refusalreason: '' },
    notices: [
      badge('Refused: {{ form.values.refusalReason }}', 'danger', { visible: "form.values.status === 'refused'" }),
      { ...text('Approved by {{ form.values.approver }} on {{ form.values.approvedAt }}', 'muted'), rules: { visible: '!!form.values.approver' } },
      grid([
        { type: 'canvas.form.input', props: { label: 'Approver', placeholder: 'Who approves this request?', value: '{{ state.approver }}' }, rules: visibleWhenSubmitted },
        { type: 'canvas.form.input', props: { label: 'Refusal reason', placeholder: 'Why is it refused?', value: '{{ state.refusalreason }}' }, rules: visibleWhenSubmitted },
      ]),
    ],
    buttons: [
      button('Submit', 'submit', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      button('Approve', 'approve', { visible: submitted, disabled: idle }, undefined, 'check'),
      button('Refuse', 'refuse', { visible: submitted, disabled: idle }, 'outline', 'x'),
      button('Copy name', 'copy-employee', { visible: `${draft} && !!form.values.employeeRef`, disabled: `form.saving || ${archived}` }, 'ghost', 'copy'),
    ],
    actions: {
      'copy-employee': { steps: [{ 'patch-form': { values: { employeeName: `{{ ${copyName} }}` } } }] },
      submit: scriptAction(postScriptPath, 'submit', {
        confirm: { title: 'Submit request', message: 'Submit this leave request? Its days are computed as the weekday count of the date range, and it can no longer be edited.' },
      }),
      approve: scriptAction(postScriptPath, 'approve', {
        confirm: { title: 'Approve request', message: 'Approve this leave request? Approved requests count against the leave type\'s allocation.' },
        parameters: { approver: '{{ state.approver }}' },
      }),
      refuse: scriptAction(postScriptPath, 'refuse', {
        confirm: { title: 'Refuse request', message: 'Refuse this leave request? Give the reason in the Refusal reason field.' },
        parameters: { reason: '{{ state.refusalreason }}' },
      }),
    },
    locked: `!${draft}`,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...extras.buttons, recordButtons(extras.locked)]),
  ], 'between')
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `time-off-${kind}`, displayName: `Time Off ${entity.singular.toLowerCase()}`,
      description: `View and edit a Time Off ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'time-off-settings', displayName: 'Time Off settings', description: 'Edit the Time Off settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [typesAccess('Choose the default leave type for new requests'), schemaAccess],
      data: typeSources,
      tree: [
        row([
          column([heading('Time Off settings'), text('The default leave type for new requests. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        ...status('types', `The ${containers.types.path} folder could not be read. Reinstall Time Off to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Canvas expressions only have floating point numbers, so days are summed as integer ten-thousandths (exact for
// every value a file holds) and divided only for display.
const units = value => `Math.round(Number(${value} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`
const typeData = path => `((((data.types || []).find(t => t.kind === 'file' && t.data && t.path === ${path}) || {}).data || {}))`

// Every active request flattened for the pages: employee, leave type path and name, dates, days and status.
const requestRows = `(data.requests || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', typePath: e.data.type || '', type: ${typeData('e.data.type')}.name || '', startDate: e.data.startDate || '', endDate: e.data.endDate || '', days: ${units('e.data.days')}, status: e.data.status || 'draft', approver: e.data.approver || '' }))`
const pageSources = {
  requests: folder(containers.requests.path, mimeTypes.request),
  types: folder(containers.types.path, mimeTypes.type),
  rows: { kind: 'computed', expr: requestRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value[0].toUpperCase() + value.slice(1)
const requestColumns = [['code', 'Request'], ['employee', 'Employee'], ['type', 'Leave type'], ['startDate', 'First day'],
  ['endDate', 'Last day'], ['daysText', 'Days', 'end'], ['approver', 'Approver']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'types' ? 'types' : 'requests', `The ${containers[name].path} folder could not be read. Reinstall Time Off to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'time-off-home', name: 'Time Off', description: 'Time Off overview.', icon: 'calendar-off' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count leave requests and show the leave types and requests'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Time Off'), text('Leave types and leave requests are files in your workspace. Draft requests in /leave-requests, then submit, approve or refuse them from their forms.', 'muted')]),
            row([
              button('Requests', [openFile(`${installRoot}/canvas/requests.page.yaml`)], undefined, 'outline', 'calendar-off'),
              button('Allocations', [openFile(`${installRoot}/canvas/allocations.page.yaml`)], undefined, 'outline', 'chart-pie'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Draft', countOf("r.status === 'draft'"), 'file-pen', loading('requests')),
            stat('Awaiting approval', countOf("r.status === 'submitted'"), 'hourglass', loading('requests')),
            stat('Approved', countOf("r.status === 'approved'"), 'check', loading('requests')),
            stat('Days approved', `{{ ${display(`(data.rows || []).filter(r => r.status === 'approved').reduce((s, r) => s + r.days, 0)`)} }}`, 'sigma', loading('requests')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'requests', label: 'Leave requests', icon: 'calendar-off' },
            { value: 'types', label: 'Leave types', icon: 'tags' },
          ], [
            panel('requests', [row([button('Open /leave-requests', [openFile(containers.requests.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.requests.path, mimeTypes.request, [{ key: 'name', label: 'Request' }, { key: 'data.employeeName', label: 'Employee' },
                { key: 'data.startDate', label: 'First day' }, { key: 'data.endDate', label: 'Last day' }, { key: 'data.days', label: 'Days' },
                { key: 'data.status', label: 'Status' }], `No leave requests yet. Use New in ${containers.requests.path}.`)]),
            panel('types', [row([button('Open /leave-types', [openFile(containers.types.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.types.path, mimeTypes.type, [{ key: 'name', label: 'Type' }, { key: 'data.name', label: 'Name' },
                { key: 'data.daysPerYear', label: 'Days per year' }], `No leave types yet. Use New in ${containers.types.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function requestsPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}').map(r => ({ path: r.path, code: r.code, employee: r.employee, type: r.type, startDate: r.startDate, endDate: r.endDate, daysText: r.days ? ${display('r.days')} : '', approver: r.approver })) }}`,
    requestColumns, `No ${value} requests`, true)
  return {
    file: 'requests.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'time-off-requests', name: 'Leave requests', description: 'Every leave request, listed by status.', icon: 'calendar-off' },
      spec: {
        access: pageAccess('List leave requests by status with their leave type names'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Leave requests by status'), text('Every active leave request, grouped by its status. Click a row to open the request.', 'muted')]),
            button('Time Off', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-off'),
          ], 'between'),
          ...containerNotices(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'calendar-off', loading('requests'))), 4),
          tabs(statuses.map(value => ({ value, label: statusLabel(value), icon: 'calendar-off' })),
            statuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

function allocationsPage() {
  // One row per employee × leave type with approved requests: allocated days against days taken.
  const pairs = `(data.rows || []).filter(r => r.status === 'approved' && r.employee).map(r => r.employee + '|' + r.typePath).filter((v, i, a) => a.indexOf(v) === i).map(key => ({ employee: key.slice(0, key.indexOf('|')), typePath: key.slice(key.indexOf('|') + 1) }))`
  const summary = `${pairs}.map(p => ({ employee: p.employee, typePath: p.typePath, type: ${typeData('p.typePath')}.name || p.typePath, allocated: ${units(`${typeData('p.typePath')}.daysPerYear`)}, taken: (data.rows || []).filter(r => r.status === 'approved' && r.employee === p.employee && r.typePath === p.typePath).reduce((s, r) => s + r.days, 0) }))`
  const rows = `{{ (data.summary || []).sort((a, b) => (a.employee < b.employee ? -1 : a.employee > b.employee ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0)).map(s => ({ employee: s.employee, type: s.type, allocated: ${display('s.allocated')}, taken: ${display('s.taken')}, remaining: ${display('(s.allocated - s.taken)')} })) }}`
  return {
    file: 'allocations.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'time-off-allocations', name: 'Allocations', description: 'Remaining allocation per employee and leave type.', icon: 'chart-pie' },
      spec: {
        access: pageAccess('Compare approved leave days against each leave type\'s yearly allocation'),
        data: { ...pageSources, summary: { kind: 'computed', expr: summary } },
        tree: page([
          row([
            column([heading('Remaining allocations'), text('Approved leave days per employee and leave type against the type\'s yearly allocation.', 'muted')]),
            button('Time Off', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-off'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Leave types', `{{ (data.types || []).filter(e => ${active}).length }}`, 'tags', loading('types')),
            stat('Approved requests', countOf("r.status === 'approved'"), 'check', loading('requests')),
            stat('Days approved', `{{ ${display(`(data.rows || []).filter(r => r.status === 'approved').reduce((s, r) => s + r.days, 0)`)} }}`, 'sigma', loading('requests')),
          ], 3),
          card('Allocations', [table(rows, [['employee', 'Employee'], ['type', 'Leave type'], ['allocated', 'Allocated', 'end'],
            ['taken', 'Taken', 'end'], ['remaining', 'Remaining', 'end']], 'No approved requests yet')]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), requestsPage(), allocationsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
