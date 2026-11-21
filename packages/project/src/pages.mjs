// Generates the Project Canvas documents: one bound form per record kind, the settings form, the launch page and
// the task board. Completing a task (stage transition to done, completion stamp) is done by the task script the
// form runs; the form only locks tasks the script has completed.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, crm, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, taskStages } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['active', 'done'], warning: ['on-hold', 'review'], neutral: [] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Project schemas and run the task script' }
const idle = 'form.saving || form.dirty'
const done = "form.values.stage === 'done'"
const humanizedStage = stage => stage[0].toUpperCase() + stage.slice(1).split('-').join(' ')

const projectSources = {
  projects: folder(containers.projects.path, mimeTypes.project),
  projectoptions: { kind: 'computed', expr: options('projects', "e.data.name || ''") },
}
const taskSources = { tasks: folder(containers.tasks.path, mimeTypes.task) }

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const projectName = path => `(((data.projects || []).find(p => p.path === ${path}) || {}).data || {}).name || ''`
const stageTasks = (stage, filter = 'true') => `(data.tasks || []).filter(e => ${active} && e.data.stage === '${stage}' && (${filter}))`
const taskRows = (stage, filter = 'true') => `{{ ${stageTasks(stage, filter)}.map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title, project: ${projectName('e.data.project')}, priority: e.data.priority, assignee: e.data.assignee, dueDate: e.data.dueDate })) }}`
const taskColumns = [['code', 'Code'], ['title', 'Title'], ['project', 'Project'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['dueDate', 'Due']]

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
function recordExtras(kind) {
  if (kind === 'project') {
    const mine = "e.data.project === ctx.file.path"
    const rows = `{{ (data.tasks || []).filter(e => ${active} && (${mine})).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title, stage: e.data.stage, priority: e.data.priority, assignee: e.data.assignee, dueDate: e.data.dueDate })) }}`
    return {
      locked: 'false',
      access: [
        { path: crm.customers, reason: 'Offer CRM customers to link (when CRM is installed)' },
        { path: containers.tasks.path, reason: 'Summarise this project\'s tasks by stage' },
      ],
      data: {
        companies: folder(crm.customers, crm.companyMime),
        contacts: folder(crm.customers, crm.contactMime),
        customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
        ...taskSources,
      },
      notices: [],
      buttons: [],
      links: [],
      actions: {},
      tabs: [{ value: 'tasks', label: 'Tasks', icon: 'square-check-big' }],
      panels: [
        panel('tasks', [
          stats(taskStages.map(stage => stat(humanizedStage(stage), `{{ ${stageTasks(stage, mine)}.length }}`, 'square-check-big')), 4),
          card('Tasks', [table(rows,
            [['code', 'Code'], ['title', 'Title'], ['stage', 'Stage'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['dueDate', 'Due']],
            'No tasks for this project yet. Use New in /tasks.', true)]),
        ]),
      ],
    }
  }
  return {
    locked: done,
    access: [{ path: containers.projects.path, reason: 'Choose the project a task belongs to' }],
    data: projectSources,
    notices: [],
    buttons: [
      button('Complete', 'complete', { visible: `!(${done}) && !(${archived})`, disabled: idle }, undefined, 'check'),
    ],
    links: [],
    actions: {
      complete: scriptAction(postScriptPath, 'complete-task', {
        confirm: { title: 'Complete task', message: 'Mark this task done? Done tasks can no longer be edited.' },
      }),
    },
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
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...extras.buttons, recordButtons(extras.locked)]),
  ], 'between')
  const overview = [
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...(extras.tabs
      ? [tabs([{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...extras.tabs], [panel('overview', overview), ...extras.panels])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `project-${kind}`, displayName: `Project ${entity.singular.toLowerCase()}`,
      description: `View and edit a Project ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'project-settings', displayName: 'Project settings', description: 'Edit the Project settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        row([
          column([heading('Project settings'), text('Defaults new tasks start with. Code prefixes are app settings, managed with the installed app.', 'muted')]),
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

const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Code' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'project-home', name: 'Project', description: 'Projects and tasks overview.', icon: 'folder-kanban' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: Object.values(containers).map(container => ({ path: container.path, reason: `List ${container.path.slice(1)}` })),
        data: { ...projectSources, ...taskSources },
        tree: page([
          row([
            column([heading('Project'), text('Projects and tasks are files in your workspace. Draft them in their folders, then complete tasks from their forms.', 'muted')]),
            row([
              button('Task board', [openFile(`${installRoot}/canvas/board.page.yaml`)], undefined, 'outline', 'kanban'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Active projects', count('projects', "e.data.status === 'active'"), 'folder-kanban', loading('projects')),
            stat('On hold', count('projects', "e.data.status === 'on-hold'"), 'pause', loading('projects')),
            stat('Open tasks', count('tasks', "e.data.stage !== 'done'"), 'square-check-big', loading('tasks')),
            stat('Done tasks', count('tasks', "e.data.stage === 'done'"), 'check', loading('tasks')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Project to recreate it.`)[0]),
          tabs([
            { value: 'projects', label: 'Projects', icon: 'folder-kanban' },
            { value: 'tasks', label: 'Tasks', icon: 'square-check-big' },
          ], [
            panel('projects', [row([button('Open /projects', [openFile(containers.projects.path)], undefined, 'outline', 'folder-open')]),
              browse('projects', 'project', [{ key: 'data.name', label: 'Name' }, { key: 'data.status', label: 'Status' }])]),
            panel('tasks', [row([button('Open /tasks', [openFile(containers.tasks.path)], undefined, 'outline', 'folder-open')]),
              browse('tasks', 'task', [{ key: 'data.title', label: 'Title' }, { key: 'data.stage', label: 'Stage' }, { key: 'data.priority', label: 'Priority' }, { key: 'data.assignee', label: 'Assignee' }, { key: 'data.dueDate', label: 'Due' }])]),
          ]),
        ]),
      },
    },
  }
}

function boardPage() {
  return {
    file: 'board.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'project-board', name: 'Task board', description: 'Tasks grouped by stage.', icon: 'kanban' },
      spec: {
        access: [
          { path: containers.tasks.path, reason: 'Group tasks by stage' },
          { path: containers.projects.path, reason: 'Show each task\'s project name' },
        ],
        data: { ...taskSources, projects: projectSources.projects },
        tree: page([
          row([
            column([heading('Task board'), text('Every active task, grouped by stage. Click a task to open its form; complete it from there.', 'muted')]),
            button('Project', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'folder-kanban'),
          ], 'between'),
          ...status('tasks', `The ${containers.tasks.path} folder could not be read. Reinstall Project to recreate it.`),
          stats(taskStages.map(stage => stat(humanizedStage(stage), `{{ ${stageTasks(stage)}.length }}`, 'square-check-big', loading('tasks'))), 4),
          grid(taskStages.map(stage =>
            card(humanizedStage(stage), [table(taskRows(stage), taskColumns, `No ${humanizedStage(stage).toLowerCase()} tasks`, true)])), 2),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), boardPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
