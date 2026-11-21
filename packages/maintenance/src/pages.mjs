// Generates the Maintenance Canvas documents: one bound form per record kind, the launch page, the equipment
// list, the requests board by stage and the preventive plan. Stage transitions and the equipment status sync
// are enforced by the action script the request form runs; the forms only lock what the script has finished.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, grid, heading,
  humanize, iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row,
  scriptAction, sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, equipmentStatuses, installRoot, mimeTypes, recordKinds, requestStages, schemaId } from './contracts.mjs'
import { entities, postScriptPath } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const stageTones = { success: ['repaired', 'operational'], warning: ['in-progress', 'under-maintenance'], danger: ['scrap', 'scrapped'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Maintenance schemas and run the maintenance action script' }
const idle = 'form.saving || form.dirty'
// Requests stay editable until repaired or scrapped; the script moves them forward.
const finished = "(form.values.stage === 'repaired' || form.values.stage === 'scrap')"
const scrapped = "form.values.status === 'scrapped'"

const equipmentSources = {
  equipment: folder(containers.equipments.path, mimeTypes.equipment),
  equipmentoptions: { kind: 'computed', expr: options('equipment', "e.data.name || ''", "e.data.status !== 'scrapped'") },
}

/** Kind-specific data, access, actions, header buttons and links of a record form. */
function recordExtras(kind) {
  if (kind === 'equipment') {
    return {
      locked: scrapped,
      access: [schemaAccess],
      data: {},
      notices: [
        { ...text('This equipment is scrapped and can no longer be edited.', 'muted'), rules: { visible: scrapped } },
      ],
      buttons: [], links: [], actions: {},
    }
  }
  return {
    locked: finished,
    access: [{ path: containers.equipments.path, reason: 'Choose the equipment a request maintains' }, schemaAccess],
    data: equipmentSources,
    notices: [
      { ...text('This request is finished and can no longer be edited.', 'muted'), rules: { visible: finished } },
    ],
    buttons: [
      button('Start', 'start', { visible: `form.values.stage === 'new' && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'play'),
      button('Complete', 'complete', { visible: "form.values.stage === 'in-progress'", disabled: idle }, undefined, 'check'),
      button('Scrap', 'scrap', { visible: `(form.values.stage === 'new' || form.values.stage === 'in-progress') && !(${archived})`, disabled: idle }, 'ghost', 'trash-2'),
    ],
    links: [linkButton('Equipment', 'form.values.equipment', 'wrench')],
    actions: {
      start: scriptAction(postScriptPath, 'start-request', {
        confirm: { title: 'Start request', message: 'Start this maintenance request? Its equipment is put under maintenance.' },
      }),
      complete: scriptAction(postScriptPath, 'complete-request', {
        confirm: { title: 'Complete request', message: 'Mark this request repaired? Its equipment returns to operational and the request is locked.' },
      }),
      scrap: scriptAction(postScriptPath, 'scrap', {
        confirm: { title: 'Scrap equipment', message: 'Scrap this request and its equipment? Scrapped equipment cannot be maintained and the request is locked.' },
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
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, stageTones), { visible: `!!form.values.${entity.status}` })] : []),
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
      name: `maintenance-${kind}`, displayName: `Maintenance ${entity.singular.toLowerCase()}`,
      description: `View and edit a Maintenance ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const stageLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

const requestRows = `(data.requests || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, equipmentPath: e.data.equipment || '', equipment: ((((data.equipment || []).find(q => q.kind === 'file' && q.data && q.path === e.data.equipment) || {}).data || {}).name) || '', type: e.data.type || '', priority: e.data.priority || '', stage: e.data.stage || 'new', scheduledDate: e.data.scheduledDate || '', durationHours: e.data.durationHours || '' }))`
const pageSources = {
  equipment: folder(containers.equipments.path, mimeTypes.equipment),
  requests: folder(containers.requests.path, mimeTypes.request),
  rows: { kind: 'computed', expr: requestRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const requestCount = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const equipmentCount = filter => `{{ (data.equipment || []).filter(e => ${active} && (${filter})).length }}`
const requestColumns = [['code', 'Request'], ['equipment', 'Equipment'], ['type', 'Type'], ['priority', 'Priority'], ['scheduledDate', 'Scheduled'], ['durationHours', 'Hours', 'end']]
const openStageExpr = "(r.stage === 'new' || r.stage === 'in-progress')"

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'equipments' ? 'equipment' : 'requests', `The ${containers[name].path} folder could not be read. Reinstall Maintenance to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'maintenance-home', name: 'Maintenance', description: 'Maintenance overview.', icon: 'wrench' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count equipment and requests and show the maintenance containers'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Maintenance'), text('Equipment and maintenance requests are files in your workspace. Draft a request in /maintenance-requests, then start, complete or scrap it from its form.', 'muted')]),
            row([
              button('Maintenance requests', [openFile(`${installRoot}/canvas/requests.page.yaml`)], undefined, 'outline', 'hammer'),
              button('Equipment', [openFile(`${installRoot}/canvas/equipment.page.yaml`)], undefined, 'outline', 'wrench'),
              button('Preventive plan', [openFile(`${installRoot}/canvas/preventive.page.yaml`)], undefined, 'outline', 'calendar-clock'),
            ]),
          ], 'between'),
          stats([
            stat('Open requests', requestCount(openStageExpr), 'hammer', loading('requests')),
            stat('In progress', requestCount("r.stage === 'in-progress'"), 'play', loading('requests')),
            stat('Operational equipment', equipmentCount("(e.data.status || 'operational') === 'operational'"), 'wrench', loading('equipment')),
            stat('Under maintenance', equipmentCount("e.data.status === 'under-maintenance'"), 'alert-triangle', loading('equipment')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'requests', label: 'Requests', icon: 'hammer' },
            { value: 'equipment', label: 'Equipment', icon: 'wrench' },
          ], [
            panel('requests', [row([button('Open /maintenance-requests', [openFile(containers.requests.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.requests.path, mimeTypes.request, [{ key: 'name', label: 'Request' }, { key: 'data.type', label: 'Type' },
                { key: 'data.priority', label: 'Priority' }, { key: 'data.stage', label: 'Stage' }, { key: 'data.scheduledDate', label: 'Scheduled' }],
                `No requests yet. Use New in ${containers.requests.path}.`)]),
            panel('equipment', [row([button('Open /equipment', [openFile(containers.equipments.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.equipments.path, mimeTypes.equipment, [{ key: 'name', label: 'Code' }, { key: 'data.name', label: 'Name' },
                { key: 'data.category', label: 'Category' }, { key: 'data.location', label: 'Location' }, { key: 'data.status', label: 'Status' }],
                `No equipment yet. Use New in ${containers.equipments.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function requestsPage() {
  const stageTable = stage => table(`{{ (data.rows || []).filter(r => r.stage === '${stage}') }}`,
    requestColumns, `No ${stageLabel(stage).toLowerCase()} requests`, true)
  return {
    file: 'requests.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'maintenance-requests', name: 'Maintenance requests', description: 'Every maintenance request, boarded by stage.', icon: 'hammer' },
      spec: {
        access: pageAccess('Board requests by stage with their equipment names'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Requests by stage'), text('Every active maintenance request, grouped by its stage. Click a row to open the request.', 'muted')]),
            button('Maintenance', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'wrench'),
          ], 'between'),
          ...containerNotices(),
          stats(requestStages.map(stage => stat(stageLabel(stage), requestCount(`r.stage === '${stage}'`), 'hammer', loading('requests'))), 4),
          tabs(requestStages.map(stage => ({ value: stage, label: stageLabel(stage), icon: 'hammer' })),
            requestStages.map(stage => panel(stage, [stageTable(stage)]))),
        ]),
      },
    },
  }
}

function equipmentPage() {
  const rows = `{{ (data.equipment || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', category: e.data.category || '', serial: e.data.serial || '', location: e.data.location || '', assignedTo: e.data.assignedTo || '', status: e.data.status || 'operational', warrantyEnd: e.data.warrantyEnd || '', open: (data.rows || []).filter(r => r.equipmentPath === e.path && ${openStageExpr}).length })) }}`
  return {
    file: 'equipment.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'maintenance-equipment', name: 'Equipment', description: 'Every piece of equipment with its status and open requests.', icon: 'wrench' },
      spec: {
        access: pageAccess('List equipment with their open request counts'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Equipment'), text('Every active piece of equipment. The status follows its maintenance requests.', 'muted')]),
            row([
              button('Open /equipment', [openFile(containers.equipments.path)], undefined, 'outline', 'folder-open'),
              button('Maintenance', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'wrench'),
            ]),
          ], 'between'),
          ...containerNotices(),
          stats(equipmentStatuses.map(value =>
            stat(stageLabel(value), equipmentCount(`(e.data.status || 'operational') === '${value}'`), 'wrench', loading('equipment'))), 3),
          table(rows, [['code', 'Equipment'], ['name', 'Name'], ['category', 'Category'], ['serial', 'Serial'],
            ['location', 'Location'], ['assignedTo', 'Assigned to'], ['status', 'Status'], ['warrantyEnd', 'Warranty end'], ['open', 'Open requests', 'end']],
            'No equipment yet. Use New in /equipment.', true),
        ]),
      },
    },
  }
}

function preventivePage() {
  const preventiveOpen = `(data.rows || []).filter(r => r.type === 'preventive' && ${openStageExpr})`
  const overdue = `!!r.scheduledDate && r.scheduledDate < Date().slice(0, 10)`
  const soon = `!(${overdue}) && !!r.scheduledDate && r.scheduledDate <= Date(Date.now() + 30 * 86400000).slice(0, 10)`
  const rows = `{{ ${preventiveOpen}.sort((a, b) => ((a.scheduledDate || '9999') < (b.scheduledDate || '9999') ? -1 : (a.scheduledDate || '9999') > (b.scheduledDate || '9999') ? 1 : 0)).map(r => ({ path: r.path, code: r.code, equipment: r.equipment, priority: r.priority, stage: r.stage, scheduledDate: r.scheduledDate, state: (${overdue}) ? 'Overdue' : (${soon}) ? 'Upcoming' : 'Planned' })) }}`
  return {
    file: 'preventive.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'maintenance-preventive', name: 'Preventive plan', description: 'Open preventive requests against their scheduled dates.', icon: 'calendar-clock' },
      spec: {
        access: pageAccess('Compare open preventive requests against their scheduled dates'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Preventive plan'), text('Open preventive maintenance by scheduled date: overdue, upcoming within 30 days, or planned.', 'muted')]),
            button('Maintenance', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'wrench'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Open preventive', `{{ ${preventiveOpen}.length }}`, 'calendar-clock', loading('requests')),
            stat('Overdue', `{{ ${preventiveOpen}.filter(r => ${overdue}).length }}`, 'alarm-clock', loading('requests')),
            stat('Due in 30 days', `{{ ${preventiveOpen}.filter(r => ${soon}).length }}`, 'hourglass', loading('requests')),
            stat('Unscheduled', `{{ ${preventiveOpen}.filter(r => !r.scheduledDate).length }}`, 'calendar-x', loading('requests')),
          ]),
          table(rows, [['code', 'Request'], ['equipment', 'Equipment'], ['priority', 'Priority'], ['stage', 'Stage'],
            ['scheduledDate', 'Scheduled'], ['state', 'State']], 'No open preventive requests', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), requestsPage(), equipmentPage(), preventivePage(), ...recordKinds.map(recordForm)]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
