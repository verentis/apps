// Generates the Recruitment Canvas documents: a bound form per record kind, the settings form, the launch page,
// the candidate pipeline by stage and the positions list. Advancing, refusing and hiring (stage transitions,
// required refusal reason, locking) are done by the action script the candidate form runs.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, openStages, recordKinds, schemaId, settingsPath, stages } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const stageTones = { success: ['hired', 'offer'], warning: ['screening', 'interview'], danger: ['refused'] }
const jobTones = { success: ['open'], warning: ['on-hold'], danger: ['closed'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Recruitment schemas and run the candidate action script' }
const decided = `${JSON.stringify(['hired', 'refused'])}.includes(form.values.stage)`
const idle = 'form.saving || form.dirty'
const advanceable = `${JSON.stringify(['new', 'screening', 'interview'])}.includes(form.values.stage)`

const jobSources = {
  jobs: folder(containers.jobs.path, mimeTypes.job),
  joboptions: { kind: 'computed', expr: options('jobs', "e.data.title || ''") },
}
const jobsAccess = reason => ({ path: containers.jobs.path, reason })

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'job') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false', tones: jobTones }
  }
  return {
    access: [jobsAccess('Choose the job position a candidate applies for'), schemaAccess],
    data: jobSources,
    notices: [
      { ...text('Hired on {{ form.values.hiredAt }}. This candidate is locked.', 'success'),
        rules: { visible: "form.values.stage === 'hired'" } },
      { ...text('Refused: {{ form.values.refusalReason }}. This candidate is locked.', 'muted'),
        rules: { visible: "form.values.stage === 'refused'" } },
    ],
    buttons: [
      button('Advance', 'advance', { visible: `${advanceable} && !(${archived})`, disabled: idle }, undefined, 'arrow-right'),
      button('Hire', 'hire', { visible: `form.values.stage === 'offer' && !(${archived})`, disabled: idle }, undefined, 'check'),
      button('Refuse', 'refuse', { visible: `${JSON.stringify(openStages)}.includes(form.values.stage) && !(${archived})`,
        disabled: `${idle} || !String(form.values.refusalReason || '').trim()` }, 'outline', 'x'),
    ],
    actions: {
      advance: scriptAction(postScriptPath, 'advance', {
        confirm: { title: 'Advance candidate', message: 'Move this candidate to the next pipeline stage?' },
      }),
      hire: scriptAction(postScriptPath, 'hire', {
        confirm: { title: 'Hire candidate', message: 'Hire this candidate? Hired candidates are locked and cannot be edited.' },
      }),
      refuse: scriptAction(postScriptPath, 'refuse', {
        confirm: { title: 'Refuse candidate', message: 'Refuse this candidate with the refusal reason? Refused candidates are locked.' },
      }),
    },
    locked: decided,
    tones: stageTones,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, extras.tones), { visible: `!!form.values.${entity.status}` })] : []),
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
      name: `recruitment-${kind}`, displayName: `Recruitment ${entity.singular.toLowerCase()}`,
      description: `View and edit a Recruitment ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'recruitment-settings', displayName: 'Recruitment settings', description: 'Edit the Recruitment settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [jobsAccess('Choose the default job position for new candidates'), schemaAccess],
      data: jobSources,
      tree: [
        pageHeader(
          [heading('Recruitment settings'), text('The default job position for new candidates. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('jobs', `The ${containers.jobs.path} folder could not be read. Reinstall Recruitment to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const openStage = value => `${JSON.stringify(openStages)}.includes(${value})`

// Every active candidate flattened for the pages: stage, job path and title, source and expected salary.
const candidateRows = `(data.candidates || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', jobPath: e.data.job || '', job: ((((data.jobs || []).find(j => j.kind === 'file' && j.data && j.path === e.data.job) || {}).data || {}).title) || '', source: e.data.source || '', stage: e.data.stage || '', expectedSalary: e.data.expectedSalary || '' }))`
const candidateSources = {
  candidates: folder(containers.candidates.path, mimeTypes.candidate),
  jobs: folder(containers.jobs.path, mimeTypes.job),
  rows: { kind: 'computed', expr: candidateRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const stageLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const candidateColumns = [['code', 'Application'], ['name', 'Candidate'], ['job', 'Job position'], ['source', 'Source'], ['expectedSalary', 'Expected salary', 'end']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'jobs' ? 'jobs' : 'candidates', `The ${containers[name].path} folder could not be read. Reinstall Recruitment to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'recruitment-home', name: 'Recruitment', description: 'Recruitment overview.', icon: 'briefcase' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count candidates and show the job positions and candidates'),
        data: candidateSources,
        tree: page([
          pageHeader(
            [heading('Recruitment'), text('Job positions and candidates are files in your workspace. Draft applications in /candidates, move them through the pipeline, then hire or refuse them from their forms.', 'muted')], [
            row([
              button('Pipeline', [openFile(`${installRoot}/canvas/pipeline.page.yaml`)], undefined, 'outline', 'kanban'),
              button('Positions', [openFile(`${installRoot}/canvas/positions.page.yaml`)], undefined, 'outline', 'briefcase'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('In pipeline', countOf(openStage('r.stage')), 'users', loading('candidates')),
            stat('In interview', countOf("r.stage === 'interview'"), 'messages-square', loading('candidates')),
            stat('Hired', countOf("r.stage === 'hired'"), 'check', loading('candidates')),
            stat('Refused', countOf("r.stage === 'refused'"), 'x', loading('candidates')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'candidates', label: 'Candidates', icon: 'user-round' },
            { value: 'jobs', label: 'Job positions', icon: 'briefcase' },
          ], [
            panel('candidates', [row([button('Open /candidates', [openFile(containers.candidates.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.candidates.path, mimeTypes.candidate, [{ key: 'name', label: 'Application' }, { key: 'data.name', label: 'Candidate' },
                { key: 'data.source', label: 'Source' }, { key: 'data.stage', label: 'Stage' },
                { key: 'data.expectedSalary', label: 'Expected salary' }], `No candidates yet. Use New in ${containers.candidates.path}.`)]),
            panel('jobs', [row([button('Open /job-positions', [openFile(containers.jobs.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.jobs.path, mimeTypes.job, [{ key: 'name', label: 'Code' }, { key: 'data.title', label: 'Title' },
                { key: 'data.department', label: 'Department' }, { key: 'data.status', label: 'Status' },
                { key: 'data.openings', label: 'Openings' }], `No job positions yet. Use New in ${containers.jobs.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function pipelinePage() {
  const stageTable = stage => table(`{{ (data.rows || []).filter(r => r.stage === '${stage}') }}`,
    candidateColumns, `No ${stageLabel(stage).toLowerCase()} candidates`, true)
  return {
    file: 'pipeline.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'recruitment-pipeline', name: 'Pipeline', description: 'Every candidate, listed by stage.', icon: 'kanban' },
      spec: {
        access: pageAccess('List candidates by stage with their job position titles'),
        data: candidateSources,
        tree: page([
          pageHeader(
            [heading('Hiring pipeline'), text('Every active candidate, grouped by stage. Click a row to open the application.', 'muted')], [
            button('Recruitment', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'briefcase'),
          ]),
          ...containerNotices(),
          stats(stages.map(stage => stat(stageLabel(stage), countOf(`r.stage === '${stage}'`), 'user-round', loading('candidates'))), 6),
          tabs(stages.map(stage => ({ value: stage, label: stageLabel(stage), icon: 'user-round' })),
            stages.map(stage => panel(stage, [stageTable(stage)]))),
        ]),
      },
    },
  }
}

function positionsPage() {
  const jobRows = `{{ (data.jobs || []).filter(j => ${active.replaceAll('e.', 'j.')}).map(j => ({ path: j.path, code: j.data.code || j.name, title: j.data.title || '', department: j.data.department || '', status: j.data.status || '', openings: j.data.openings || 0, pipeline: (data.rows || []).filter(r => r.jobPath === j.path && ${openStage('r.stage')}).length, hired: (data.rows || []).filter(r => r.jobPath === j.path && r.stage === 'hired').length })) }}`
  return {
    file: 'positions.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'recruitment-positions', name: 'Positions', description: 'Job positions with their candidate counts.', icon: 'briefcase' },
      spec: {
        access: pageAccess('List job positions with candidate and hire counts'),
        data: candidateSources,
        tree: page([
          pageHeader(
            [heading('Job positions'), text('Every active position with its pipeline and hire counts. Click a row to open the position.', 'muted')], [
            button('Recruitment', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'briefcase'),
          ]),
          ...containerNotices(),
          stats([
            stat('Open positions', `{{ (data.jobs || []).filter(j => ${active.replaceAll('e.', 'j.')} && j.data.status === 'open').length }}`, 'briefcase', loading('jobs')),
            stat('On hold', `{{ (data.jobs || []).filter(j => ${active.replaceAll('e.', 'j.')} && j.data.status === 'on-hold').length }}`, 'pause', loading('jobs')),
            stat('Closed', `{{ (data.jobs || []).filter(j => ${active.replaceAll('e.', 'j.')} && j.data.status === 'closed').length }}`, 'lock', loading('jobs')),
            stat('Hired overall', countOf("r.stage === 'hired'"), 'check', loading('candidates')),
          ]),
          table(jobRows, [['code', 'Position'], ['title', 'Title'], ['department', 'Department'], ['status', 'Status'],
            ['openings', 'Openings', 'end'], ['pipeline', 'In pipeline', 'end'], ['hired', 'Hired', 'end']], 'No job positions yet', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), pipelinePage(), positionsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
