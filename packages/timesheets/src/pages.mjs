// Generates the Timesheets Canvas documents: the bound entry form, the settings form, the launch page and the
// weekly hours-by-project page. Validating (hours check, immutability) is done by the validation script the form
// runs; the form only locks what the script has validated.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, project, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['validated'], warning: ['draft'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Timesheets schemas and run the validation script' }
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"

/** Project (optional) sources: the selects stay empty when the Project app is not installed. */
const projectSources = {
  projects: folder(project.projects, project.projectMime),
  projectoptions: { kind: 'computed', expr: options('projects', "e.data.name || ''") },
  tasks: folder(project.tasks, project.taskMime),
  taskoptions: { kind: 'computed', expr: options('tasks', "e.data.title || ''") },
}
const entrySources = { entries: folder(containers.entries.path, mimeTypes.entry) }

// Canvas expressions only have floating point numbers, so hours are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = hours => `Math.round(Number(${hours} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`

function recordForm(kind) {
  const entity = entities[kind]
  const locked = `!${draft}`
  const readOnly = `${archived} || (${locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }}`, 'muted'),
    ]),
    row([
      button('Validate', 'validate', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      recordButtons(locked),
    ]),
  ], 'between')
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `timesheets-${kind}`, displayName: `Timesheets ${entity.singular.toLowerCase()}`,
      description: `View and edit a Timesheets ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [
        { path: project.projects, reason: 'Offer projects to log time against (when Project is installed)' },
        { path: project.tasks, reason: 'Offer tasks to log time against (when Project is installed)' },
        schemaAccess,
      ],
      data: projectSources,
      tree: [
        header,
        ...status('record'), ...lifecycle(entity),
        archivedAlert(entity.singular),
        badge('Validated entries are locked. Hours were checked when it was validated.', 'success', { visible: locked }, 'check'),
        grid(sectionCards(entity.sections, readOnly)),
      ],
      actions: {
        ...baseActions,
        validate: scriptAction(postScriptPath, 'validate-entry', {
          confirm: { title: 'Validate entry', message: 'Validate this timesheet entry? Validated entries can no longer be edited.' },
        }),
      },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'timesheets-settings', displayName: 'Timesheets settings', description: 'Edit the Timesheets settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        pageHeader(
          [heading('Timesheets settings'), text('Defaults new entries start with. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const sumHours = filter => `{{ ${display(`(data.entries || []).filter(e => ${active} && (${filter})).reduce((s, e) => s + ${units('e.data.hours')}, 0)`)} }}`

// This week is the last seven days, today inclusive; dates are compared as YYYY-MM-DD strings.
const weekStart = "Date(Date.now() - 6 * 86400000).slice(0, 10)"
const inWeek = `e.data.date >= ${weekStart} && e.data.date <= Date().slice(0, 10)`
const projectName = path => `((((data.projects || []).find(p => p.path === ${path}) || {}).data || {}).name || ${path} || '(no project)')`

/** Validated and draft hours of this week's entries, grouped by project, in integer ten-thousandths. */
const weekEntries = `(data.entries || []).filter(e => ${active} && (${inWeek}))`
const sumWeek = status => `${weekEntries}.filter(e => (e.data.project || '') === key && (e.data.status === 'validated') === ${status}).reduce((s, e) => s + ${units('e.data.hours')}, 0)`
const weekly = `${weekEntries}.map(e => e.data.project || '').filter((key, index, keys) => keys.indexOf(key) === index).map(key => ({ key, project: ${projectName('key')}, entries: ${weekEntries}.filter(e => (e.data.project || '') === key).length, validated: ${sumWeek(true)}, draft: ${sumWeek(false)} })).sort((a, b) => (b.validated + b.draft) - (a.validated + a.draft))`

const weeklySources = {
  ...entrySources,
  projects: projectSources.projects,
  weekly: { kind: 'computed', expr: weekly },
}

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'timesheets-home', name: 'Timesheets', description: 'Timesheet entries overview.', icon: 'clock' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          { path: containers.entries.path, reason: 'List timesheet entries' },
          { path: project.projects, reason: 'Show project names (when Project is installed)' },
        ],
        data: { ...entrySources, projects: projectSources.projects },
        tree: page([
          pageHeader(
            [heading('Timesheets'), text('Timesheet entries are files in your workspace. Draft them in /timesheets, then validate them from their forms.', 'muted')], [
            row([
              button('This week', [openFile(`${installRoot}/canvas/week.page.yaml`)], undefined, 'outline', 'calendar-days'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Draft entries', count('entries', "e.data.status === 'draft'"), 'file-pen', loading('entries')),
            stat('Validated entries', count('entries', "e.data.status === 'validated'"), 'check', loading('entries')),
            stat('Draft hours', sumHours("e.data.status === 'draft'"), 'hourglass', loading('entries')),
            stat('Validated hours', sumHours("e.data.status === 'validated'"), 'clock', loading('entries')),
          ]),
          status('entries', `The ${containers.entries.path} folder could not be read. Reinstall Timesheets to recreate it.`)[0],
          row([button('Open /timesheets', [openFile(containers.entries.path)], undefined, 'outline', 'folder-open')]),
          browser(containers.entries.path, mimeTypes.entry, [
            { key: 'name', label: 'Code' }, { key: 'data.employee', label: 'Employee' }, { key: 'data.date', label: 'Date' },
            { key: 'data.hours', label: 'Hours', align: 'end' }, { key: 'data.status', label: 'Status' },
          ], `No entries yet. Use New in ${containers.entries.path}.`),
        ]),
      },
    },
  }
}

function weekPage() {
  const rows = `{{ (data.weekly || []).map(g => ({ project: g.project, entries: g.entries, draft: ${display('g.draft')}, validated: ${display('g.validated')}, total: ${display('(g.draft + g.validated)')} })) }}`
  return {
    file: 'week.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'timesheets-week', name: 'This week', description: 'Hours by project over the last seven days.', icon: 'calendar-days' },
      spec: {
        access: [
          { path: containers.entries.path, reason: 'Sum this week\'s hours by project' },
          { path: project.projects, reason: 'Show project names (when Project is installed)' },
        ],
        data: weeklySources,
        tree: page([
          pageHeader(
            [heading('This week'), text(`Hours by project over the last seven days, today inclusive (since {{ ${weekStart} }}).`, 'muted')], [
            button('Timesheets', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'clock'),
          ]),
          ...status('entries'),
          stats([
            stat('Hours this week', `{{ ${display('(data.weekly || []).reduce((s, g) => s + g.draft + g.validated, 0)')} }}`, 'clock', loading('entries')),
            stat('Validated', `{{ ${display('(data.weekly || []).reduce((s, g) => s + g.validated, 0)')} }}`, 'check', loading('entries')),
            stat('Projects', '{{ (data.weekly || []).length }}', 'folder-kanban', loading('entries')),
          ], 3),
          table(rows, [['project', 'Project'], ['entries', 'Entries', 'end'], ['draft', 'Draft hours', 'end'],
            ['validated', 'Validated hours', 'end'], ['total', 'Total', 'end']], 'No hours logged this week'),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), weekPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
