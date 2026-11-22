// Generates the Surveys Canvas documents: a bound form per record kind, the settings form, the launch page,
// the surveys-by-status list and the results summary. Opening and closing surveys and submitting responses
// (transitions, questionnaire and answer validation, stamps, locking) are done by the action script the
// forms run.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import {
  containers, installRoot, mimeTypes, ratingMax, recordKinds, schemaId, settingsPath, surveyStatuses,
} from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const surveyTones = { success: ['open'], danger: ['closed'] }
const responseTones = { success: ['submitted'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Surveys schemas and run the action script' }
const idle = 'form.saving || form.dirty'
const surveyLocked = "form.values.status === 'closed'"
const responseLocked = "form.values.status === 'submitted'"

const surveySources = {
  surveys: folder(containers.surveys.path, mimeTypes.survey),
  surveyoptions: { kind: 'computed', expr: options('surveys', "e.data.title || ''") },
}
const surveysAccess = reason => ({ path: containers.surveys.path, reason })
const responsesAccess = reason => ({ path: containers.responses.path, reason })

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
/** Submitted responses against one survey. */
const submittedFor = surveyPath => `(data.responses || []).filter(r => r.kind === 'file' && r.data && r.data.state !== 'archived' && r.data.status === 'submitted' && r.data.survey === ${surveyPath})`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'survey') {
    return {
      access: [responsesAccess('Count submitted responses against this survey'), schemaAccess],
      data: { responses: folder(containers.responses.path, mimeTypes.response) },
      notices: [
        { ...text(`Submitted responses: {{ ${submittedFor('ctx.file.path')}.length }}.`, 'muted'),
          rules: { visible: "form.values.status !== 'draft'" } },
        { ...text('This survey is closed and can no longer be edited.', 'muted'), rules: { visible: surveyLocked } },
      ],
      buttons: [
        button('Open', 'open', { visible: `form.values.status === 'draft' && !(${archived})`,
          disabled: `${idle} || !(form.values.questions || []).length` }, undefined, 'megaphone'),
        button('Close', 'close', { visible: `form.values.status === 'open' && !(${archived})`, disabled: idle }, 'outline', 'lock'),
      ],
      actions: {
        open: scriptAction(postScriptPath, 'open', {
          confirm: { title: 'Open survey', message: 'Open this survey? The questionnaire is validated and open surveys accept submitted responses.' },
        }),
        close: scriptAction(postScriptPath, 'close', {
          confirm: { title: 'Close survey', message: 'Close this survey? Closed surveys are locked and accept no more responses.' },
        }),
      },
      locked: surveyLocked,
    }
  }
  return {
    access: [
      surveysAccess('Choose the survey a response answers'),
      schemaAccess,
    ],
    data: { ...surveySources },
    notices: [
      { ...text('This response has been submitted and is locked.', 'muted'), rules: { visible: responseLocked } },
    ],
    buttons: [
      button('Submit', 'submit', { visible: `form.values.status === 'draft' && !(${archived})`,
        disabled: `${idle} || !form.values.survey` }, undefined, 'send'),
    ],
    actions: {
      submit: scriptAction(postScriptPath, 'submit', {
        confirm: { title: 'Submit response', message: 'Submit this response? The answers are validated against the survey and the response is locked.' },
      }),
    },
    locked: responseLocked,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const tones = kind === 'survey' ? surveyTones : responseTones
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, tones), { visible: `!!form.values.${entity.status}` }),
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
    grid(sectionCards(entity.sections, readOnly), 1),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `surveys-${kind}`, displayName: `Surveys ${entity.singular.toLowerCase()}`,
      description: `View and edit a Surveys ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'surveys-settings', displayName: 'Surveys settings', description: 'Edit the Surveys settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [surveysAccess('Choose the default survey for new responses'), schemaAccess],
      data: surveySources,
      tree: [
        row([
          column([heading('Surveys settings'), text('The default survey for new responses. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        ...status('surveys', `The ${containers.surveys.path} folder could not be read. Reinstall Surveys to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active survey flattened for the pages: status, question count and submitted/draft response counts.
const surveyRows = `(data.surveys || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', status: e.data.status || '', questions: (e.data.questions || []).length, submitted: ${submittedFor('e.path')}.length, drafts: (data.responses || []).filter(r => r.kind === 'file' && r.data && r.data.state !== 'archived' && r.data.status === 'draft' && r.data.survey === e.path).length }))`

// Per-question results over the submitted responses: a tally row per choice, an average row per rating
// question and an answered count per text question.
const resultRows = `(data.surveys || []).filter(e => ${active}).map(e => { var subs = ${submittedFor('e.path')}.map(r => r.data); return (e.data.questions || []).map(q => { var answers = subs.map(r => (r.answers || []).filter(a => a.sequence === q.sequence)[0]).filter(a => !!a); if (q.kind === 'rating') { var ratings = answers.map(a => Number(a.value)).filter(v => v >= 1 && v <= ${ratingMax}); return [{ path: e.path, survey: e.data.code || e.name, question: q.text || '', metric: 'Average rating', value: ratings.length ? (ratings.reduce((t, v) => t + v, 0) / ratings.length).toFixed(1) : '' }] } if (q.kind === 'single-choice') { return (q.choices || []).map(c => ({ path: e.path, survey: e.data.code || e.name, question: q.text || '', metric: c, value: answers.filter(a => a.value === c).length })) } if (q.kind === 'multi-choice') { return (q.choices || []).map(c => ({ path: e.path, survey: e.data.code || e.name, question: q.text || '', metric: c, value: answers.filter(a => (a.values || []).indexOf(c) >= 0).length })) } return [{ path: e.path, survey: e.data.code || e.name, question: q.text || '', metric: 'Answered', value: answers.filter(a => String(a.value || '').trim()).length }] }).reduce((all, rows) => all.concat(rows), []) }).reduce((all, rows) => all.concat(rows), [])`

const pageSources = {
  surveys: folder(containers.surveys.path, mimeTypes.survey),
  responses: folder(containers.responses.path, mimeTypes.response),
  rows: { kind: 'computed', expr: surveyRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const surveyColumns = [['code', 'Survey'], ['title', 'Title'], ['questions', 'Questions', 'end'],
  ['submitted', 'Submitted', 'end'], ['drafts', 'Drafts', 'end']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Surveys to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'surveys-home', name: 'Surveys', description: 'Surveys overview.', icon: 'clipboard-list' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count surveys and responses and show them'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Surveys'), text('Surveys and responses are files in your workspace. Draft a questionnaire in /surveys, open it, then submit responses from their forms.', 'muted')]),
            row([
              button('All surveys', [openFile(`${installRoot}/canvas/surveys.page.yaml`)], undefined, 'outline', 'clipboard-list'),
              button('Results', [openFile(`${installRoot}/canvas/results.page.yaml`)], undefined, 'outline', 'bar-chart'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Open surveys', countOf("r.status === 'open'"), 'megaphone', loading('surveys')),
            stat('Draft surveys', countOf("r.status === 'draft'"), 'pencil', loading('surveys')),
            stat('Closed surveys', countOf("r.status === 'closed'"), 'lock', loading('surveys')),
            stat('Submitted responses', '{{ (data.rows || []).reduce((total, r) => total + r.submitted, 0) }}', 'send', loading('responses')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'surveys', label: 'Surveys', icon: 'clipboard-list' },
            { value: 'responses', label: 'Responses', icon: 'message-square-text' },
          ], [
            panel('surveys', [row([button('Open /surveys', [openFile(containers.surveys.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.surveys.path, mimeTypes.survey, [{ key: 'name', label: 'Survey' }, { key: 'data.title', label: 'Title' },
                { key: 'data.status', label: 'Status' }], `No surveys yet. Use New in ${containers.surveys.path}.`)]),
            panel('responses', [row([button('Open /survey-responses', [openFile(containers.responses.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.responses.path, mimeTypes.response, [{ key: 'name', label: 'Response' }, { key: 'data.respondentName', label: 'Respondent' },
                { key: 'data.status', label: 'Status' }], `No responses yet. Use New in ${containers.responses.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function surveysPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}') }}`,
    surveyColumns, `No ${statusLabel(value).toLowerCase()} surveys`, true)
  return {
    file: 'surveys.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'surveys-surveys', name: 'All surveys', description: 'Every survey, listed by status.', icon: 'clipboard-list' },
      spec: {
        access: pageAccess('List surveys by status with their response counts'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Surveys by status'), text('Every active survey, grouped by its status. Click a row to open the survey.', 'muted')]),
            button('Surveys', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'clipboard-list'),
          ], 'between'),
          ...containerNotices(),
          stats(surveyStatuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'clipboard-list', loading('surveys'))), 3),
          tabs(surveyStatuses.map(value => ({ value, label: statusLabel(value), icon: 'clipboard-list' })),
            surveyStatuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

function resultsPage() {
  return {
    file: 'results.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'surveys-results', name: 'Results', description: 'Per-question results over the submitted responses.', icon: 'bar-chart' },
      spec: {
        access: pageAccess('Tally choices and average ratings over the submitted responses'),
        data: { ...pageSources, results: { kind: 'computed', expr: resultRows } },
        tree: page([
          row([
            column([heading('Results'), text(`Per-choice tallies, average ratings (1-${ratingMax}) and answered counts, computed from the submitted responses. Click a row to open the survey.`, 'muted')]),
            button('Surveys', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'clipboard-list'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Surveys', '{{ (data.rows || []).length }}', 'clipboard-list', loading('surveys')),
            stat('Submitted responses', '{{ (data.rows || []).reduce((total, r) => total + r.submitted, 0) }}', 'send', loading('responses')),
            stat('Draft responses', '{{ (data.rows || []).reduce((total, r) => total + r.drafts, 0) }}', 'pencil', loading('responses')),
          ], 3),
          card('Responses per survey', [table('{{ data.rows || [] }}', surveyColumns, 'No surveys yet', true)]),
          card('Results per question', [table('{{ data.results || [] }}', [['survey', 'Survey'], ['question', 'Question'],
            ['metric', 'Choice / metric'], ['value', 'Result', 'end']], 'No submitted responses yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), surveysPage(), resultsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
