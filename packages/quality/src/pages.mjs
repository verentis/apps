// Generates the Quality Canvas documents: one bound form per record kind, the launch page, the checks list by
// result, the alerts board by stage and the control points list. Recording a check (pending → pass/fail,
// tolerance validation, auto-alert on fail) and resolving an alert are done by the action script the forms run.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row,
  scriptAction, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { alertStages, checkTypes, containers, installRoot, mimeTypes, recordKinds, results, schemaId } from './contracts.mjs'
import { entities, postScriptPath } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const resultTones = { success: ['pass'], warning: ['pending'], danger: ['fail'] }
const stageTones = { success: ['resolved'], warning: ['investigation', 'action'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Quality schemas and run the quality action script' }
const idle = 'form.saving || form.dirty'
// Checks stay editable while pending; recording sets the result and locks the check.
const pending = "(!form.values.result || form.values.result === 'pending')"
const resolved = "form.values.stage === 'resolved'"
const resolvable = `${JSON.stringify(['investigation', 'action'])}.includes(form.values.stage)`

/** Bound form controls; `switch` is a local extension for boolean fields (the control point's `active`). */
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

const pointSources = {
  points: folder(containers.points.path, mimeTypes.point),
  pointoptions: { kind: 'computed', expr: options('points', "e.data.title || ''", 'e.data.active !== false') },
}

/** Kind-specific data, access, actions, header buttons and links of a record form. */
function recordExtras(kind) {
  if (kind === 'point') {
    return { locked: 'false', access: [schemaAccess], data: {}, notices: [], buttons: [], links: [], actions: {} }
  }
  if (kind === 'check') {
    return {
      locked: `!${pending}`,
      access: [{ path: containers.points.path, reason: 'Choose the control point a check verifies' }, schemaAccess],
      data: pointSources,
      notices: [
        { ...text('This check is recorded and can no longer be edited.', 'muted'), rules: { visible: `!${pending}` } },
      ],
      buttons: [
        button('Record pass', 'record-pass', { visible: `${pending} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
        button('Record fail', 'record-fail', { visible: `${pending} && !(${archived})`, disabled: `${idle} || form.invalid` }, 'outline', 'x'),
      ],
      links: [linkButton('Control point', 'form.values.point', 'crosshair'), linkButton('Alert', 'form.values.alert', 'siren')],
      actions: {
        'record-pass': scriptAction(postScriptPath, 'record-check', {
          parameters: { result: 'pass' },
          confirm: { title: 'Record pass', message: 'Record this check as passed? Measure checks are validated against the control point tolerance. Recorded checks are locked.' },
        }),
        'record-fail': scriptAction(postScriptPath, 'record-check', {
          parameters: { result: 'fail' },
          confirm: { title: 'Record fail', message: 'Record this check as failed? A quality alert is raised for it. Recorded checks are locked.' },
        }),
      },
    }
  }
  return {
    locked: resolved,
    access: [schemaAccess],
    data: {},
    notices: [
      { ...text('This alert is resolved and can no longer be edited.', 'muted'), rules: { visible: resolved } },
    ],
    buttons: [
      button('Resolve', 'resolve', { visible: `${resolvable} && !(${archived})`,
        disabled: `${idle} || !String(form.values.rootCause || '').trim() || !String(form.values.correctiveAction || '').trim()` }, undefined, 'check'),
    ],
    links: [linkButton('Source check', 'form.values.sourceCheck', 'clipboard-check')],
    actions: {
      resolve: scriptAction(postScriptPath, 'resolve-alert', {
        confirm: { title: 'Resolve alert', message: 'Resolve this alert with its root cause and corrective action? Resolved alerts are locked.' },
      }),
    },
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const tones = kind === 'alert' ? stageTones : resultTones
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, tones), { visible: `!!form.values.${entity.status}` })] : []),
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
    ...(extras.links.length ? [row(extras.links)] : []),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `quality-${kind}`, displayName: `Quality ${entity.singular.toLowerCase()}`,
      description: `View and edit a Quality ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const stageLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

const checkRows = `(data.checks || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, point: ((((data.points || []).find(p => p.kind === 'file' && p.data && p.path === e.data.point) || {}).data || {}).title) || '', date: e.data.date || '', reference: e.data.reference || '', result: e.data.result || 'pending', measuredValue: e.data.measuredValue || '' }))`
const alertRows = `(data.alerts || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', severity: e.data.severity || '', stage: e.data.stage || 'new' }))`
const pageSources = {
  points: folder(containers.points.path, mimeTypes.point),
  checks: folder(containers.checks.path, mimeTypes.check),
  alerts: folder(containers.alerts.path, mimeTypes.alert),
  checkrows: { kind: 'computed', expr: checkRows },
  alertrows: { kind: 'computed', expr: alertRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const checkCount = filter => `{{ (data.checkrows || []).filter(r => ${filter}).length }}`
const alertCount = filter => `{{ (data.alertrows || []).filter(r => ${filter}).length }}`
const checkColumns = [['code', 'Check'], ['point', 'Control point'], ['date', 'Date'], ['reference', 'Reference'], ['measuredValue', 'Measured', 'end'], ['result', 'Result']]
const alertColumns = [['code', 'Alert'], ['title', 'Title'], ['severity', 'Severity'], ['stage', 'Stage']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Quality to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'quality-home', name: 'Quality', description: 'Quality overview.', icon: 'badge-check' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count checks and alerts and show the quality containers'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Quality'), text('Control points, checks and alerts are files in your workspace. Draft a check in /quality-checks, record it from its form; failed checks raise alerts.', 'muted')]),
            row([
              button('Quality checks', [openFile(`${installRoot}/canvas/checks.page.yaml`)], undefined, 'outline', 'clipboard-check'),
              button('Quality alerts', [openFile(`${installRoot}/canvas/alerts.page.yaml`)], undefined, 'outline', 'siren'),
              button('Control points', [openFile(`${installRoot}/canvas/points.page.yaml`)], undefined, 'outline', 'crosshair'),
            ]),
          ], 'between'),
          stats([
            stat('Pending checks', checkCount("r.result === 'pending'"), 'clipboard-list', loading('checks')),
            stat('Failed checks', checkCount("r.result === 'fail'"), 'x', loading('checks')),
            stat('Open alerts', alertCount("r.stage !== 'resolved'"), 'siren', loading('alerts')),
            stat('High severity', alertCount("r.stage !== 'resolved' && r.severity === 'high'"), 'alert-triangle', loading('alerts')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'checks', label: 'Checks', icon: 'clipboard-check' },
            { value: 'alerts', label: 'Alerts', icon: 'siren' },
            { value: 'points', label: 'Control points', icon: 'crosshair' },
          ], [
            panel('checks', [row([button('Open /quality-checks', [openFile(containers.checks.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.checks.path, mimeTypes.check, [{ key: 'name', label: 'Check' }, { key: 'data.reference', label: 'Reference' },
                { key: 'data.date', label: 'Date' }, { key: 'data.result', label: 'Result' }], `No checks yet. Use New in ${containers.checks.path}.`)]),
            panel('alerts', [row([button('Open /quality-alerts', [openFile(containers.alerts.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.alerts.path, mimeTypes.alert, [{ key: 'name', label: 'Alert' }, { key: 'data.title', label: 'Title' },
                { key: 'data.severity', label: 'Severity' }, { key: 'data.stage', label: 'Stage' }], `No alerts yet. Use New in ${containers.alerts.path}.`)]),
            panel('points', [row([button('Open /quality-control-points', [openFile(containers.points.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.points.path, mimeTypes.point, [{ key: 'name', label: 'Point' }, { key: 'data.title', label: 'Title' },
                { key: 'data.checkType', label: 'Type' }, { key: 'data.frequency', label: 'Frequency' }], `No control points yet. Use New in ${containers.points.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function checksPage() {
  const resultTable = result => table(`{{ (data.checkrows || []).filter(r => r.result === '${result}') }}`,
    checkColumns, `No ${result} checks`, true)
  return {
    file: 'checks.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'quality-checks', name: 'Quality checks', description: 'Every quality check, listed by result.', icon: 'clipboard-check' },
      spec: {
        access: pageAccess('List checks by result with their control point titles'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Checks by result'), text('Every active quality check, grouped by its result. Click a row to open the check.', 'muted')]),
            button('Quality', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'badge-check'),
          ], 'between'),
          ...containerNotices(),
          stats(results.map(result => stat(stageLabel(result), checkCount(`r.result === '${result}'`), 'clipboard-check', loading('checks'))), 3),
          tabs(results.map(result => ({ value: result, label: stageLabel(result), icon: 'clipboard-check' })),
            results.map(result => panel(result, [resultTable(result)]))),
        ]),
      },
    },
  }
}

function alertsPage() {
  const stageTable = stage => table(`{{ (data.alertrows || []).filter(r => r.stage === '${stage}') }}`,
    alertColumns, `No ${stageLabel(stage).toLowerCase()} alerts`, true)
  return {
    file: 'alerts.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'quality-alerts', name: 'Quality alerts', description: 'Every quality alert, boarded by stage.', icon: 'siren' },
      spec: {
        access: pageAccess('Board alerts by stage'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Alerts by stage'), text('Every active quality alert, grouped by its stage. Click a row to open the alert.', 'muted')]),
            button('Quality', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'badge-check'),
          ], 'between'),
          ...containerNotices(),
          stats(alertStages.map(stage => stat(stageLabel(stage), alertCount(`r.stage === '${stage}'`), 'siren', loading('alerts'))), 4),
          tabs(alertStages.map(stage => ({ value: stage, label: stageLabel(stage), icon: 'siren' })),
            alertStages.map(stage => panel(stage, [stageTable(stage)]))),
        ]),
      },
    },
  }
}

function pointsPage() {
  const rows = `{{ (data.points || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', reference: e.data.reference || '', checkType: e.data.checkType || '', frequency: e.data.frequency || '', target: e.data.measureTarget || '', active: e.data.active === false ? 'No' : 'Yes', checks: (data.checks || []).filter(c => c.kind === 'file' && c.data && c.data.point === e.path).length })) }}`
  return {
    file: 'points.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'quality-points', name: 'Control points', description: 'The control points checks verify.', icon: 'crosshair' },
      spec: {
        access: pageAccess('List control points with their check counts'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Control points'), text('What is checked, how and how often. Inactive points cannot record checks.', 'muted')]),
            row([
              button('Open /quality-control-points', [openFile(containers.points.path)], undefined, 'outline', 'folder-open'),
              button('Quality', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'badge-check'),
            ]),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Control points', `{{ (data.points || []).filter(e => ${active}).length }}`, 'crosshair', loading('points')),
            ...checkTypes.map(type => stat(stageLabel(type), `{{ (data.points || []).filter(e => ${active} && e.data.checkType === '${type}').length }}`, 'crosshair', loading('points'))),
          ], 3),
          table(rows, [['code', 'Point'], ['title', 'Title'], ['reference', 'Product / operation'], ['checkType', 'Type'],
            ['frequency', 'Frequency'], ['target', 'Target', 'end'], ['active', 'Active'], ['checks', 'Checks', 'end']],
            'No control points yet. Use New in /quality-control-points.', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), checksPage(), alertsPage(), pointsPage(), ...recordKinds.map(recordForm)]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
