// Generates the Helpdesk Canvas documents: a bound form per record kind, the settings form, the launch page,
// the ticket list by stage, the SLA/overdue report and the team workload summary. Resolving and closing
// (stage transitions, resolution text, locking) are done by the action script the ticket form runs.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, crm, installRoot, mimeTypes, openStages, recordKinds, schemaId, settingsPath, stages } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const stageTones = { success: ['solved'], warning: ['waiting'], danger: ['closed'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Helpdesk schemas and run the ticket action script' }
const closed = "form.values.stage === 'closed'"
const idle = 'form.saving || form.dirty'
// Builds a Canvas-expression array literal from constant stage names (no JSON.stringify: CodeQL js/bad-code-sanitization).
const stageLiteral = values => `[${values.map(v => {
  if (!/^[a-z0-9-]+$/.test(v)) throw new Error(`unsafe expression value: ${v}`)
  return `'${v}'`
}).join(', ')}]`
const resolvable = `${stageLiteral(['in-progress', 'waiting'])}.includes(form.values.stage)`

const teamSources = {
  teams: folder(containers.teams.path, mimeTypes.team),
  teamoptions: { kind: 'computed', expr: options('teams', "e.data.name || ''") },
}
const teamsAccess = reason => ({ path: containers.teams.path, reason })

const fromCrm = "e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' ')"
const copyName = `((data.companies || []).concat(data.contacts || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.customerRef).map(e => ${fromCrm})[0]) || form.values.customerName`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'team') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [
      teamsAccess('Choose the team a ticket belongs to'),
      { path: crm.customers, reason: 'Offer CRM customers on tickets (when CRM is installed)' },
      schemaAccess,
    ],
    data: {
      ...teamSources,
      companies: folder(crm.customers, crm.companyMime),
      contacts: folder(crm.customers, crm.contactMime),
      customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
    },
    notices: [
      { ...text('Overdue: the SLA deadline {{ form.values.slaDeadline }} has passed.', 'danger'),
        rules: { visible: `${stageLiteral(openStages)}.includes(form.values.stage) && !!form.values.slaDeadline && form.values.slaDeadline < Date()` } },
      { ...text('This ticket is closed and can no longer be edited.', 'muted'), rules: { visible: closed } },
    ],
    buttons: [
      button('Resolve', 'resolve', { visible: `${resolvable} && !(${archived})`,
        disabled: `${idle} || !String(form.values.resolution || '').trim()` }, undefined, 'check'),
      button('Close', 'close', { visible: `form.values.stage === 'solved' && !(${archived})`, disabled: idle }, 'outline', 'lock'),
      button('Copy name', 'copy-customer', { visible: `!(${closed}) && !!form.values.customerRef`, disabled: `form.saving || ${archived}` }, 'ghost', 'copy'),
    ],
    actions: {
      'copy-customer': { steps: [{ 'patch-form': { values: { customerName: `{{ ${copyName} }}` } } }] },
      resolve: scriptAction(postScriptPath, 'resolve', {
        confirm: { title: 'Resolve ticket', message: 'Mark this ticket solved with its resolution text? Solved tickets can only be closed.' },
      }),
      close: scriptAction(postScriptPath, 'close', {
        confirm: { title: 'Close ticket', message: 'Close this solved ticket? Closed tickets are locked and cannot be edited.' },
      }),
    },
    locked: closed,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, stageTones), { visible: `!!form.values.${entity.status}` })] : []),
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
    // Record discussion: a hidden chat channel attached to this ticket file (canvas.collab.discussion
    // resolves it by reference through the workspace chat service; shown only where chat is available).
    ...(kind === 'ticket'
      ? [{
          type: 'canvas.collab.discussion',
          props: {
            reference: 'vfs:{{ ctx.file.path }}',
            title: 'Ticket {{ form.values.code }}',
            placeholder: 'Message the team about this ticket…',
          },
        }]
      : []),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `helpdesk-${kind}`, displayName: `Helpdesk ${entity.singular.toLowerCase()}`,
      description: `View and edit a Helpdesk ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'helpdesk-settings', displayName: 'Helpdesk settings', description: 'Edit the Helpdesk settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [teamsAccess('Choose the default team for new tickets'), schemaAccess],
      data: teamSources,
      tree: [
        pageHeader(
          [heading('Helpdesk settings'), text('The default team for new tickets. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('teams', `The ${containers.teams.path} folder could not be read. Reinstall Helpdesk to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const openStage = value => `${stageLiteral(openStages)}.includes(${value})`

// Every active ticket flattened for the pages: stage, team path and name, deadline and overdue flag.
const ticketRows = `(data.tickets || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, subject: e.data.subject || '', teamPath: e.data.team || '', team: ((((data.teams || []).find(t => t.kind === 'file' && t.data && t.path === e.data.team) || {}).data || {}).name) || '', priority: e.data.priority || '', stage: e.data.stage || '', assignee: e.data.assignee || '', deadline: e.data.slaDeadline || '', overdue: ${openStage('e.data.stage')} && !!e.data.slaDeadline && e.data.slaDeadline < Date() }))`
const ticketSources = {
  tickets: folder(containers.tickets.path, mimeTypes.ticket),
  teams: folder(containers.teams.path, mimeTypes.team),
  rows: { kind: 'computed', expr: ticketRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const openRows = `(data.rows || []).filter(r => ${openStage('r.stage')})`
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const stageLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const ticketColumns = [['code', 'Ticket'], ['subject', 'Subject'], ['team', 'Team'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['deadline', 'SLA deadline']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'teams' ? 'teams' : 'tickets', `The ${containers[name].path} folder could not be read. Reinstall Helpdesk to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'helpdesk-home', name: 'Helpdesk', description: 'Helpdesk overview.', icon: 'ticket' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count tickets and show the teams and tickets'),
        data: ticketSources,
        tree: page([
          pageHeader(
            [heading('Helpdesk'), text('Teams and tickets are files in your workspace. Draft tickets in /tickets, work them by stage, then resolve and close them from their forms.', 'muted')], [
            row([
              button('Tickets', [openFile(`${installRoot}/canvas/tickets.page.yaml`)], undefined, 'outline', 'ticket'),
              button('SLA report', [openFile(`${installRoot}/canvas/sla.page.yaml`)], undefined, 'outline', 'alarm-clock'),
              button('Workload', [openFile(`${installRoot}/canvas/workload.page.yaml`)], undefined, 'outline', 'users'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Open tickets', countOf(openStage('r.stage')), 'ticket', loading('tickets')),
            stat('Overdue', countOf('r.overdue'), 'alarm-clock', loading('tickets')),
            stat('New', countOf("r.stage === 'new'"), 'inbox', loading('tickets')),
            stat('Solved', countOf("r.stage === 'solved'"), 'check', loading('tickets')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'tickets', label: 'Tickets', icon: 'ticket' },
            { value: 'teams', label: 'Teams', icon: 'users' },
          ], [
            panel('tickets', [row([button('Open /tickets', [openFile(containers.tickets.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.tickets.path, mimeTypes.ticket, [{ key: 'name', label: 'Ticket' }, { key: 'data.subject', label: 'Subject' },
                { key: 'data.priority', label: 'Priority' }, { key: 'data.stage', label: 'Stage' }, { key: 'data.assignee', label: 'Assignee' },
                { key: 'data.slaDeadline', label: 'SLA deadline' }], `No tickets yet. Use New in ${containers.tickets.path}.`)]),
            panel('teams', [row([button('Open /helpdesk-teams', [openFile(containers.teams.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.teams.path, mimeTypes.team, [{ key: 'name', label: 'Team' }, { key: 'data.name', label: 'Name' },
                { key: 'data.slaHours', label: 'SLA hours' }], `No teams yet. Use New in ${containers.teams.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function ticketsPage() {
  const stageTable = stage => table(`{{ (data.rows || []).filter(r => r.stage === '${stage}') }}`,
    ticketColumns, `No ${stageLabel(stage).toLowerCase()} tickets`, true)
  return {
    file: 'tickets.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'helpdesk-tickets', name: 'Tickets', description: 'Every ticket, listed by stage.', icon: 'ticket' },
      spec: {
        access: pageAccess('List tickets by stage with their team names'),
        data: ticketSources,
        tree: page([
          pageHeader(
            [heading('Tickets by stage'), text('Every active ticket, grouped by its stage. Click a row to open the ticket.', 'muted')], [
            button('Helpdesk', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'ticket'),
          ]),
          ...containerNotices(),
          stats(stages.map(stage => stat(stageLabel(stage), countOf(`r.stage === '${stage}'`), 'ticket', loading('tickets'))), 5),
          tabs(stages.map(stage => ({ value: stage, label: stageLabel(stage), icon: 'ticket' })),
            stages.map(stage => panel(stage, [stageTable(stage)]))),
        ]),
      },
    },
  }
}

function slaPage() {
  const soon = `!r.overdue && !!r.deadline && r.deadline < Date(Date.now() + 86400000)`
  const rows = `{{ ${openRows}.sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : 0)).map(r => ({ path: r.path, code: r.code, subject: r.subject, team: r.team, priority: r.priority, assignee: r.assignee, deadline: r.deadline, state: r.overdue ? 'Overdue' : (${soon} ? 'Due soon' : 'On track') })) }}`
  return {
    file: 'sla.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'helpdesk-sla', name: 'SLA report', description: 'Open tickets against their SLA deadlines.', icon: 'alarm-clock' },
      spec: {
        access: pageAccess('Compare open tickets against their SLA deadlines'),
        data: ticketSources,
        tree: page([
          pageHeader(
            [heading('SLA report'), text('Open tickets by SLA deadline. The deadline is computed from the team\'s SLA hours when a ticket is created.', 'muted')], [
            button('Helpdesk', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'ticket'),
          ]),
          ...containerNotices(),
          stats([
            stat('Open', `{{ ${openRows}.length }}`, 'ticket', loading('tickets')),
            stat('Overdue', `{{ ${openRows}.filter(r => r.overdue).length }}`, 'alarm-clock', loading('tickets')),
            stat('Due in 24 h', `{{ ${openRows}.filter(r => ${soon}).length }}`, 'hourglass', loading('tickets')),
            stat('Unassigned', `{{ ${openRows}.filter(r => !r.assignee).length }}`, 'user-x', loading('tickets')),
          ]),
          table(rows, [['code', 'Ticket'], ['subject', 'Subject'], ['team', 'Team'], ['priority', 'Priority'],
            ['assignee', 'Assignee'], ['deadline', 'SLA deadline'], ['state', 'State']], 'No open tickets', true),
        ]),
      },
    },
  }
}

function workloadPage() {
  const teamRows = `{{ (data.teams || []).filter(t => t.kind === 'file' && t.data && t.data.state !== 'archived').map(t => ({ path: t.path, team: t.data.name || t.name, members: (t.data.members || []).length, slaHours: t.data.slaHours || '', open: (data.rows || []).filter(r => r.teamPath === t.path && ${openStage('r.stage')}).length, overdue: (data.rows || []).filter(r => r.teamPath === t.path && r.overdue).length, solved: (data.rows || []).filter(r => r.teamPath === t.path && r.stage === 'solved').length })) }}`
  const assigneeRows = `{{ ${openRows}.map(r => r.assignee || 'Unassigned').filter((v, i, a) => a.indexOf(v) === i).sort().map(a => ({ assignee: a, open: ${openRows}.filter(r => (r.assignee || 'Unassigned') === a).length, overdue: ${openRows}.filter(r => (r.assignee || 'Unassigned') === a && r.overdue).length })) }}`
  return {
    file: 'workload.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'helpdesk-workload', name: 'Workload', description: 'Open tickets per team and assignee.', icon: 'users' },
      spec: {
        access: pageAccess('Sum open tickets per team and assignee'),
        data: ticketSources,
        tree: page([
          pageHeader(
            [heading('Team workload'), text('Open tickets per team and per assignee. Click a team to open it.', 'muted')], [
            button('Helpdesk', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'ticket'),
          ]),
          ...containerNotices(),
          card('Teams', [table(teamRows, [['team', 'Team'], ['members', 'Members', 'end'], ['slaHours', 'SLA hours', 'end'],
            ['open', 'Open', 'end'], ['overdue', 'Overdue', 'end'], ['solved', 'Solved', 'end']], 'No teams yet', true)]),
          card('Assignees', [table(assigneeRows, [['assignee', 'Assignee'], ['open', 'Open', 'end'], ['overdue', 'Overdue', 'end']], 'No open tickets')]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), ticketsPage(), slaPage(), workloadPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
