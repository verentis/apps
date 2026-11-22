// Generates the Field Service Canvas documents: the bound task form, the settings form, the launch page, the
// task list by stage and the technician day schedule. Stage transitions (schedule, start, complete, cancel),
// the materials total and the optional invoice draft are done by the action script the task form runs.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, crm, installRoot, mimeTypes, openStages, recordKinds, schemaId, settingsPath, stages } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const stageTones = { success: ['done'], warning: ['on-site'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Field Service schemas and run the task action script' }
const locked = "['done', 'cancelled'].includes(form.values.stage)"
const idle = 'form.saving || form.dirty'
// Builds a Canvas-expression array literal from constant stage names (no JSON.stringify: CodeQL js/bad-code-sanitization).
const stageLiteral = values => `[${values.map(v => {
  if (!/^[a-z0-9-]+$/.test(v)) throw new Error(`unsafe expression value: ${v}`)
  return `'${v}'`
}).join(', ')}]`

const fromCrm = "e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' ')"
const copyName = `((data.companies || []).concat(data.contacts || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.customerRef).map(e => ${fromCrm})[0]) || form.values.customerName`

function taskForm() {
  const entity = entities.task
  const readOnly = `${archived} || (${locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, stageTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([
      button('Schedule', 'schedule', { visible: `form.values.stage === 'new' && !(${archived})`,
        disabled: `${idle} || !form.values.scheduledDate || !String(form.values.technician || '').trim()` }, undefined, 'calendar'),
      button('Start', 'start', { visible: `form.values.stage === 'scheduled' && !(${archived})`, disabled: idle }, undefined, 'play'),
      button('Complete', 'complete', { visible: `form.values.stage === 'on-site' && !(${archived})`,
        disabled: `${idle} || !String(form.values.hours || '').trim()` }, undefined, 'check'),
      button('Cancel task', 'cancel', { visible: `${stageLiteral(openStages)}.includes(form.values.stage) && !(${archived})`, disabled: idle }, 'outline', 'x'),
      button('Copy name', 'copy-customer', { visible: `!(${locked}) && !!form.values.customerRef`, disabled: `form.saving || ${archived}` }, 'ghost', 'copy'),
      recordButtons(locked),
    ]),
  ], 'between')
  return {
    file: 'task.form.yaml',
    document: boundForm({
      name: 'field-service-task', displayName: 'Field Service task',
      description: 'View and edit a Field Service task.', icon: iconName(entity.icon),
      mime: mimeTypes.task, schemaId: schemaId('task'), schemaSource: `${installRoot}/schemas/task.schema.json`,
      access: [
        { path: crm.customers, reason: 'Offer CRM customers on tasks (when CRM is installed)' },
        schemaAccess,
      ],
      data: {
        companies: folder(crm.customers, crm.companyMime),
        contacts: folder(crm.customers, crm.contactMime),
        customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
      },
      tree: [
        header,
        ...status('record'),
        badge('This task is archived. Restore it to edit.', 'warning', { visible: archived }, 'archive'),
        { ...text('This task is done and can no longer be edited. Its materials total was computed when it was completed.', 'muted'),
          rules: { visible: "form.values.stage === 'done'" } },
        { ...text('This task was cancelled and can no longer be edited.', 'muted'), rules: { visible: "form.values.stage === 'cancelled'" } },
        { ...text('An invoice was drafted for this task: {{ form.values.invoice }}', 'muted'), rules: { visible: '!!form.values.invoice' } },
        grid(sectionCards(entity.sections, readOnly)),
      ],
      actions: {
        ...baseActions,
        'copy-customer': { steps: [{ 'patch-form': { values: { customerName: `{{ ${copyName} }}` } } }] },
        schedule: scriptAction(postScriptPath, 'schedule', {
          confirm: { title: 'Schedule task', message: 'Schedule this task for its date and technician?' },
        }),
        start: scriptAction(postScriptPath, 'start', {
          confirm: { title: 'Start task', message: 'Mark the technician on site?' },
        }),
        complete: scriptAction(postScriptPath, 'complete', {
          confirm: { title: 'Complete task', message: 'Complete this task? The materials total is computed, an invoice may be drafted and the task is locked.' },
        }),
        cancel: scriptAction(postScriptPath, 'cancel', {
          confirm: { title: 'Cancel task', message: 'Cancel this task? Cancelled tasks are locked and cannot be edited.' },
        }),
      },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'field-service-settings', displayName: 'Field Service settings', description: 'Edit the Field Service settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        row([
          column([heading('Field Service settings'), text('Defaults new tasks start with. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const openStage = value => `${stageLiteral(openStages)}.includes(${value})`

// Every active task flattened for the pages: stage, schedule, technician and the time window.
const taskRows = `(data.tasks || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, customer: e.data.customerName || '', address: e.data.address || '', type: e.data.type || '', stage: e.data.stage || '', technician: e.data.technician || '', date: e.data.scheduledDate || '', window: [e.data.windowStart, e.data.windowEnd].filter(Boolean).join('–'), windowStart: e.data.windowStart || '', hours: e.data.hours || '', today: !!e.data.scheduledDate && e.data.scheduledDate === Date().slice(0, 10) }))`
const taskSources = {
  tasks: folder(containers.tasks.path, mimeTypes.task),
  rows: { kind: 'computed', expr: taskRows },
}
const pageAccess = reason => [{ path: containers.tasks.path, reason }]
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const stageLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const taskColumns = [['code', 'Task'], ['customer', 'Customer'], ['type', 'Type'], ['technician', 'Technician'], ['date', 'Date'], ['window', 'Window']]

const containerNotice = () => status('tasks', `The ${containers.tasks.path} folder could not be read. Reinstall Field Service to recreate it.`)

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'field-service-home', name: 'Field Service', description: 'Field Service overview.', icon: 'wrench' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count tasks and show the task list'),
        data: taskSources,
        tree: page([
          row([
            column([heading('Field Service'), text('Field tasks are files in your workspace. Draft tasks in /field-tasks, schedule a technician, work them on site, then complete them from their forms.', 'muted')]),
            row([
              button('Tasks', [openFile(`${installRoot}/canvas/tasks.page.yaml`)], undefined, 'outline', 'wrench'),
              button('Day schedule', [openFile(`${installRoot}/canvas/schedule.page.yaml`)], undefined, 'outline', 'calendar'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Open tasks', countOf(openStage('r.stage')), 'wrench', loading('tasks')),
            stat('Today', countOf(`r.today && ${openStage('r.stage')}`), 'calendar', loading('tasks')),
            stat('On site', countOf("r.stage === 'on-site'"), 'map-pin', loading('tasks')),
            stat('Done', countOf("r.stage === 'done'"), 'check', loading('tasks')),
          ]),
          ...containerNotice(),
          row([button('Open /field-tasks', [openFile(containers.tasks.path)], undefined, 'outline', 'folder-open')]),
          browser(containers.tasks.path, mimeTypes.task, [{ key: 'name', label: 'Task' }, { key: 'data.customerName', label: 'Customer' },
            { key: 'data.type', label: 'Type' }, { key: 'data.stage', label: 'Stage' }, { key: 'data.technician', label: 'Technician' },
            { key: 'data.scheduledDate', label: 'Date' }], `No tasks yet. Use New in ${containers.tasks.path}.`),
        ]),
      },
    },
  }
}

function tasksPage() {
  const stageTable = stage => table(`{{ (data.rows || []).filter(r => r.stage === '${stage}') }}`,
    taskColumns, `No ${stageLabel(stage).toLowerCase()} tasks`, true)
  return {
    file: 'tasks.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'field-service-tasks', name: 'Tasks', description: 'Every field task, listed by stage.', icon: 'wrench' },
      spec: {
        access: pageAccess('List tasks by stage'),
        data: taskSources,
        tree: page([
          row([
            column([heading('Tasks by stage'), text('Every active field task, grouped by its stage. Click a row to open the task.', 'muted')]),
            button('Field Service', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'wrench'),
          ], 'between'),
          ...containerNotice(),
          stats(stages.map(stage => stat(stageLabel(stage), countOf(`r.stage === '${stage}'`), 'wrench', loading('tasks'))), 5),
          tabs(stages.map(stage => ({ value: stage, label: stageLabel(stage), icon: 'wrench' })),
            stages.map(stage => panel(stage, [stageTable(stage)]))),
        ]),
      },
    },
  }
}

function schedulePage() {
  const todayRows = `(data.rows || []).filter(r => r.today && ${openStage('r.stage')})`
  const dayList = `{{ ${todayRows}.sort((a, b) => ((a.technician || '~') + (a.windowStart || '~')) < ((b.technician || '~') + (b.windowStart || '~')) ? -1 : 1).map(r => ({ path: r.path, technician: r.technician || 'Unassigned', window: r.window, code: r.code, customer: r.customer, address: r.address, type: r.type, stage: r.stage })) }}`
  const technicianRows = `{{ ${todayRows}.map(r => r.technician || 'Unassigned').filter((v, i, a) => a.indexOf(v) === i).sort().map(t => ({ technician: t, tasks: ${todayRows}.filter(r => (r.technician || 'Unassigned') === t).length, onsite: ${todayRows}.filter(r => (r.technician || 'Unassigned') === t && r.stage === 'on-site').length })) }}`
  return {
    file: 'schedule.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'field-service-schedule', name: 'Day schedule', description: 'Today\'s tasks per technician.', icon: 'calendar' },
      spec: {
        access: pageAccess('List today\'s tasks per technician'),
        data: taskSources,
        tree: page([
          row([
            column([heading('Day schedule'), text('Today\'s open tasks, ordered by technician and time window. Click a row to open the task.', 'muted')]),
            button('Field Service', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'wrench'),
          ], 'between'),
          ...containerNotice(),
          stats([
            stat('Tasks today', `{{ ${todayRows}.length }}`, 'calendar', loading('tasks')),
            stat('On site', `{{ ${todayRows}.filter(r => r.stage === 'on-site').length }}`, 'map-pin', loading('tasks')),
            stat('Unassigned', `{{ ${todayRows}.filter(r => !r.technician).length }}`, 'user-x', loading('tasks')),
            stat('Technicians', `{{ ${todayRows}.map(r => r.technician || 'Unassigned').filter((v, i, a) => a.indexOf(v) === i).length }}`, 'users', loading('tasks')),
          ]),
          card('Technicians', [table(technicianRows, [['technician', 'Technician'], ['tasks', 'Tasks', 'end'], ['onsite', 'On site', 'end']], 'No tasks today')]),
          card('Day list', [table(dayList, [['technician', 'Technician'], ['window', 'Window'], ['code', 'Task'], ['customer', 'Customer'],
            ['address', 'Address'], ['type', 'Type'], ['stage', 'Stage']], 'No tasks today', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), tasksPage(), schedulePage(), ...recordKinds.map(() => taskForm()), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
