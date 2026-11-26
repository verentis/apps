// Generates the Appraisals Canvas documents: the bound appraisal form, the settings form, the launch page,
// the appraisals list by status and the scores summary. Scheduling and completing (status transitions, ratings
// check, overall score computation, locking) are done by the action script the appraisal form runs.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, employees, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, statuses } from './contracts.mjs'
import { appraisee, entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['done'], warning: ['scheduled'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Appraisals schemas and run the appraisal action script' }
const done = "form.values.status === 'done'"
const idle = 'form.saving || form.dirty'


/** Data, access, actions, header buttons and notices of the appraisal form. */
function recordExtras() {
  return {
    access: [
      ...appraisee.sources.access,
      schemaAccess,
    ],
    data: {
      ...appraisee.sources.data,
    },
    notices: [
      { ...text('Completed on {{ form.values.completedAt }} with an overall score of {{ form.values.overallScore }}. This appraisal is locked.', 'success'),
        rules: { visible: done } },
      { ...text('This appraisal is cancelled.', 'muted'), rules: { visible: "form.values.status === 'cancelled'" } },
    ],
    buttons: [
      button('Schedule', 'schedule', { visible: `form.values.status === 'draft' && !(${archived})`, disabled: idle }, 'outline', 'calendar'),
      button('Complete', 'complete', { visible: `form.values.status === 'scheduled' && !(${archived})`,
        disabled: `${idle} || !(form.values.ratings || []).length` }, undefined, 'check'),
    ],
    actions: {
      schedule: scriptAction(postScriptPath, 'schedule', {
        confirm: { title: 'Schedule appraisal', message: 'Schedule this appraisal on its scheduled date (today when empty)?' },
      }),
      complete: scriptAction(postScriptPath, 'complete', {
        confirm: { title: 'Complete appraisal', message: 'Complete this appraisal and compute its overall score from the ratings? Done appraisals are locked.' },
      }),
    },
    locked: done,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras()
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
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
      name: `appraisals-${kind}`, displayName: `Appraisals ${entity.singular.toLowerCase()}`,
      description: `View and edit an ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'appraisals-settings', displayName: 'Appraisals settings', description: 'Edit the Appraisals settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        pageHeader(
          [heading('Appraisals settings'), text('The default manager for new appraisals. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active appraisal flattened for the pages: status, scheduled date, rating count and overall score.
const appraisalRows = `(data.appraisals || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', period: e.data.period || '', manager: e.data.manager || '', status: e.data.status || '', scheduledAt: e.data.scheduledAt || '', ratings: (e.data.ratings || []).length, overallScore: e.data.overallScore || '' }))`
const appraisalSources = {
  appraisals: folder(containers.appraisals.path, mimeTypes.appraisal),
  rows: { kind: 'computed', expr: appraisalRows },
}
const pageAccess = reason => [{ path: containers.appraisals.path, reason }]
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const appraisalColumns = [['code', 'Appraisal'], ['employee', 'Employee'], ['period', 'Period'], ['manager', 'Manager'], ['scheduledAt', 'Scheduled'], ['overallScore', 'Overall score', 'end']]

const containerNotice = () => status('appraisals', `The ${containers.appraisals.path} folder could not be read. Reinstall Appraisals to recreate it.`)[0]

// Done appraisals carry an exact decimal overallScore string; averages are summed in integer hundredths.
const doneRows = `(data.rows || []).filter(r => r.status === 'done' && r.overallScore)`
const averageScore = `{{ ${doneRows}.length ? (${doneRows}.map(r => Math.round(Number(r.overallScore) * 100)).reduce((sum, v) => sum + v, 0) / ${doneRows}.length / 100).toFixed(2) : '—' }}`

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appraisals-home', name: 'Appraisals', description: 'Appraisals overview.', icon: 'clipboard-check' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count appraisals and show them'),
        data: appraisalSources,
        tree: page([
          pageHeader(
            [heading('Appraisals'), text('Employee appraisals are files in your workspace. Draft them in /appraisals, schedule them, rate the criteria, then complete them from their forms.', 'muted')], [
            row([
              button('By status', [openFile(`${installRoot}/canvas/appraisals.page.yaml`)], undefined, 'outline', 'list'),
              button('Scores', [openFile(`${installRoot}/canvas/scores.page.yaml`)], undefined, 'outline', 'star'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Draft', countOf("r.status === 'draft'"), 'pencil', loading('appraisals')),
            stat('Scheduled', countOf("r.status === 'scheduled'"), 'calendar', loading('appraisals')),
            stat('Done', countOf("r.status === 'done'"), 'check', loading('appraisals')),
            stat('Average score', averageScore, 'star', loading('appraisals')),
          ]),
          containerNotice(),
          row([button('Open /appraisals', [openFile(containers.appraisals.path)], undefined, 'outline', 'folder-open')]),
          browser(containers.appraisals.path, mimeTypes.appraisal, [{ key: 'name', label: 'Appraisal' }, { key: 'data.employeeName', label: 'Employee' },
            { key: 'data.period', label: 'Period' }, { key: 'data.status', label: 'Status' }, { key: 'data.scheduledAt', label: 'Scheduled' },
            { key: 'data.overallScore', label: 'Overall score' }], `No appraisals yet. Use New in ${containers.appraisals.path}.`),
        ]),
      },
    },
  }
}

function appraisalsPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}') }}`,
    appraisalColumns, `No ${statusLabel(value).toLowerCase()} appraisals`, true)
  return {
    file: 'appraisals.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appraisals-list', name: 'Appraisals by status', description: 'Every appraisal, listed by status.', icon: 'list' },
      spec: {
        access: pageAccess('List appraisals by status'),
        data: appraisalSources,
        tree: page([
          pageHeader(
            [heading('Appraisals by status'), text('Every active appraisal, grouped by its status. Click a row to open the appraisal.', 'muted')], [
            button('Appraisals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'clipboard-check'),
          ]),
          containerNotice(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'clipboard-check', loading('appraisals'))), 4),
          tabs(statuses.map(value => ({ value, label: statusLabel(value), icon: 'clipboard-check' })),
            statuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

function scoresPage() {
  const scoreRows = `{{ ${doneRows}.sort((a, b) => Number(b.overallScore) - Number(a.overallScore)) }}`
  const managerRows = `{{ ${doneRows}.map(r => r.manager || 'No manager').filter((v, i, a) => a.indexOf(v) === i).sort().map(m => ({ manager: m, done: ${doneRows}.filter(r => (r.manager || 'No manager') === m).length, average: (${doneRows}.filter(r => (r.manager || 'No manager') === m).map(r => Math.round(Number(r.overallScore) * 100)).reduce((sum, v) => sum + v, 0) / ${doneRows}.filter(r => (r.manager || 'No manager') === m).length / 100).toFixed(2) })) }}`
  return {
    file: 'scores.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appraisals-scores', name: 'Scores', description: 'Completed appraisals and their overall scores.', icon: 'star' },
      spec: {
        access: pageAccess('Summarise completed appraisals\' overall scores'),
        data: appraisalSources,
        tree: page([
          pageHeader(
            [heading('Scores summary'), text('Completed appraisals by overall score, and the average per manager. Click a row to open the appraisal.', 'muted')], [
            button('Appraisals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'clipboard-check'),
          ]),
          containerNotice(),
          stats([
            stat('Completed', `{{ ${doneRows}.length }}`, 'check', loading('appraisals')),
            stat('Average score', averageScore, 'star', loading('appraisals')),
            stat('Top score', `{{ ${doneRows}.length ? ${doneRows}.map(r => r.overallScore).sort((a, b) => Number(b) - Number(a))[0] : '—' }}`, 'trophy', loading('appraisals')),
            stat('Scheduled', countOf("r.status === 'scheduled'"), 'calendar', loading('appraisals')),
          ]),
          card('Completed appraisals', [table(scoreRows, [['code', 'Appraisal'], ['employee', 'Employee'], ['period', 'Period'],
            ['manager', 'Manager'], ['ratings', 'Ratings', 'end'], ['overallScore', 'Overall score', 'end']], 'No completed appraisals yet', true)]),
          card('By manager', [table(managerRows, [['manager', 'Manager'], ['done', 'Completed', 'end'], ['average', 'Average score', 'end']], 'No completed appraisals yet')]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), appraisalsPage(), scoresPage(), ...recordKinds.map(recordForm), settingsForm(), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
