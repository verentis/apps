// Generates the Approvals Canvas documents: one bound form per record kind, the settings form, the launch page,
// the requests list, the to-decide list and the per-type summary. Submitting, approving, refusing and cancelling
// (required fields, thresholds, immutability) are done by the decision script the request form runs; the forms
// only lock what the script has moved beyond draft.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['approved'], warning: ['draft'], danger: ['refused'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Approvals schemas and run the decision script' }
const typeSources = {
  types: folder(containers.types.path, mimeTypes.type),
  typeoptions: { kind: 'computed', expr: options('types', "e.data.name || ''") },
}
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"
const submitted = "form.values.status === 'submitted'"
const cancellable = `(${draft} || ${submitted})`

/** A form control; `switch` fields render the Canvas switch the shared helper has no case for. */
const control = (field, readOnly) => field.type === 'switch'
  ? { type: 'canvas.form.switch',
      props: { label: field.label, value: `{{ form.values.${field.key} }}`, ...(field.description ? { description: field.description } : {}) },
      rules: { disabled: readOnly } }
  : formControl(field, readOnly)
const sectionCards = (sections, readOnly) =>
  sections.map(section => card(section.title, [grid(section.fields.map(field => control(field, readOnly)))], section.description))

// The request's own type record, joined inline from the types folder source.
const ownType = "(((data.types || []).find(e => e.path === form.values.type) || {}).data || {})"
const approveCount = values => `new Set((${values}.approvals || []).filter(a => a.decision === 'approve').map(a => a.approver)).size`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'type') {
    return { access: [], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  const visibleWhenSubmitted = { visible: submitted }
  return {
    access: [{ path: containers.types.path, reason: 'Offer the approval types and show each request\'s threshold' }],
    data: typeSources,
    state: { approver: '', comment: '' },
    notices: [
      text(`Approvals {{ ${approveCount('form.values')} }} of {{ ${ownType}.requiredApprovers || '?' }} required`, 'muted'),
      { ...text('Decided {{ form.values.decidedAt }}', 'muted'), rules: { visible: '!!form.values.decidedAt' } },
      grid([
        { type: 'canvas.form.input', props: { label: 'Approver', placeholder: 'Who decides?', value: '{{ state.approver }}' }, rules: visibleWhenSubmitted },
        { type: 'canvas.form.input', props: { label: 'Comment', placeholder: 'Required when refusing', value: '{{ state.comment }}' }, rules: visibleWhenSubmitted },
      ]),
      table("{{ (form.values.approvals || []).map(a => ({ approver: a.approver, decision: a.decision, date: a.date, comment: a.comment })) }}",
        [['approver', 'Approver'], ['decision', 'Decision'], ['date', 'Date'], ['comment', 'Comment']], 'No decisions yet'),
    ],
    buttons: [
      button('Submit', 'submit', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      button('Approve', 'approve', { visible: submitted, disabled: idle }, undefined, 'check'),
      button('Refuse', 'refuse', { visible: submitted, disabled: idle }, 'outline', 'x'),
      button('Cancel request', 'cancel', { visible: `${cancellable} && !(${archived})`, disabled: idle }, 'ghost', 'ban'),
    ],
    actions: {
      submit: scriptAction(postScriptPath, 'submit', {
        confirm: { title: 'Submit request', message: 'Submit this request for approval? The type\'s required fields are checked and submitted requests can no longer be edited.' },
      }),
      approve: scriptAction(postScriptPath, 'approve', {
        confirm: { title: 'Approve request', message: 'Record your approval? When enough distinct approvers have approved, the request is approved and locked.' },
        parameters: { approver: '{{ state.approver }}', comment: '{{ state.comment }}' },
      }),
      refuse: scriptAction(postScriptPath, 'refuse', {
        confirm: { title: 'Refuse request', message: 'Refuse this request? One refusal decides it. Give the reason in the Comment field.' },
        parameters: { approver: '{{ state.approver }}', comment: '{{ state.comment }}' },
      }),
      cancel: scriptAction(postScriptPath, 'cancel', {
        confirm: { title: 'Cancel request', message: 'Cancel this request? Only the requester should cancel; cancelled requests stay in the workspace.' },
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
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
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
      name: `approvals-${kind}`, displayName: `Approvals ${entity.singular.toLowerCase()}`,
      description: `View and edit an Approvals ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, state: extras.state, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'approvals-settings', displayName: 'Approvals settings', description: 'Edit the Approvals settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        row([
          column([heading('Approvals settings'), text('New requests are prefilled with the default requester. Number prefixes are app settings, managed with the installed app.', 'muted')]),
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
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active request projected for lists, joined with its type.
const typeOf = "(((data.types || []).find(t => t.path === e.data.type) || {}).data || {})"
const requestRows = `(data.requests || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', requester: e.data.requester || '', type: e.data.type || '', typeName: ${typeOf}.name || '', required: ${typeOf}.requiredApprovers || 0, approvers: (e.data.approvals || []).filter(a => a.decision === 'approve').map(a => a.approver), deciders: (e.data.approvals || []).map(a => a.approver), amount: e.data.amount || '', date: e.data.date || '', status: e.data.status || 'draft' }))`
const requestSources = {
  requests: folder(containers.requests.path, mimeTypes.request),
  types: folder(containers.types.path, mimeTypes.type),
  rows: { kind: 'computed', expr: requestRows },
}
const containerAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const progress = 'r.approvers.length + " / " + (r.required || "?")'

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'approvals-home', name: 'Approvals', description: 'Approvals overview.', icon: 'file-check' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: containerAccess('List approval requests and types'),
        data: requestSources,
        tree: page([
          row([
            column([heading('Approvals'), text('Approval types and requests are files in your workspace. Draft a request in its folder, then submit it; approvers decide from its form until the type\'s threshold approves it, one refusal refuses it.', 'muted')]),
            row([
              button('Requests', [openFile(`${installRoot}/canvas/requests.page.yaml`)], undefined, 'outline', 'file-check'),
              button('To decide', [openFile(`${installRoot}/canvas/pending.page.yaml`)], undefined, 'outline', 'hourglass'),
              button('By type', [openFile(`${installRoot}/canvas/by-type.page.yaml`)], undefined, 'outline', 'list-checks'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Draft requests', count('requests', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('requests')),
            stat('Awaiting decision', count('requests', "e.data.status === 'submitted'"), 'hourglass', loading('requests')),
            stat('Approved', count('requests', "e.data.status === 'approved'"), 'check', loading('requests')),
            stat('Refused', count('requests', "e.data.status === 'refused'"), 'x', loading('requests')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Approvals to recreate it.`)[0]),
          tabs([
            { value: 'requests', label: 'Approval requests', icon: 'file-check' },
            { value: 'types', label: 'Approval types', icon: 'list-checks' },
          ], [
            panel('requests', [row([button(`Open ${containers.requests.path}`, [openFile(containers.requests.path)], undefined, 'outline', 'folder-open')]),
              browse('requests', 'request', [{ key: 'data.title', label: 'Title' }, { key: 'data.requester', label: 'Requester' }, { key: 'data.amount', label: 'Amount', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('types', [row([button(`Open ${containers.types.path}`, [openFile(containers.types.path)], undefined, 'outline', 'folder-open')]),
              browse('types', 'type', [{ key: 'data.name', label: 'Name' }, { key: 'data.requiredApprovers', label: 'Required approvals', align: 'end' }])]),
          ]),
        ]),
      },
    },
  }
}

function requestsPage() {
  const rows = `{{ (data.rows || []).filter(r => state.showall || (r.status !== 'approved' && r.status !== 'refused' && r.status !== 'cancelled')).map(r => ({ path: r.path, code: r.code, title: r.title, requester: r.requester, typeName: r.typeName, amount: r.amount, approvals: ${progress}, status: r.status })) }}`
  return {
    file: 'requests.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'approvals-requests', name: 'Approval requests', description: 'Approval requests by status.', icon: 'file-check' },
      spec: {
        access: containerAccess('List approval requests with their types, thresholds and statuses'),
        data: requestSources,
        state: { showall: false },
        tree: page([
          row([
            column([heading('Approval requests'), text('Open requests by status; decided and cancelled ones sit behind the switch.', 'muted')]),
            button('Approvals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'file-check'),
          ], 'between'),
          status('requests')[0],
          stats([
            stat('Draft', count('requests', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('requests')),
            stat('Awaiting decision', count('requests', "e.data.status === 'submitted'"), 'hourglass', loading('requests')),
            stat('Approved', count('requests', "e.data.status === 'approved'"), 'check', loading('requests')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show approved, refused and cancelled requests', value: '{{ state.showall }}' } },
          table(rows, [['code', 'Request'], ['title', 'Title'], ['requester', 'Requester'], ['typeName', 'Type'], ['amount', 'Amount', 'end'],
            ['approvals', 'Approvals', 'end'], ['status', 'Status']], 'No approval requests', true),
        ]),
      },
    },
  }
}

function pendingPage() {
  // Submitted requests the named approver has not decided yet (everything submitted when no name is given).
  const rows = `{{ (data.rows || []).filter(r => r.status === 'submitted' && (!state.me || !r.deciders.includes(state.me))).map(r => ({ path: r.path, code: r.code, title: r.title, requester: r.requester, typeName: r.typeName, amount: r.amount, date: r.date, approvals: ${progress} })) }}`
  return {
    file: 'pending.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'approvals-pending', name: 'To decide', description: 'Submitted requests awaiting a decision.', icon: 'hourglass' },
      spec: {
        access: containerAccess('List submitted requests awaiting an approver\'s decision'),
        data: requestSources,
        state: { me: '' },
        tree: page([
          row([
            column([heading('To decide'), text('Submitted requests awaiting approval. Give your name to hide the ones you already decided.', 'muted')]),
            button('Approvals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'file-check'),
          ], 'between'),
          status('requests')[0],
          { type: 'canvas.form.input', props: { label: 'Your name', placeholder: 'Hide requests you already decided', value: '{{ state.me }}' } },
          table(rows, [['code', 'Request'], ['title', 'Title'], ['requester', 'Requester'], ['typeName', 'Type'], ['amount', 'Amount', 'end'],
            ['date', 'Date'], ['approvals', 'Approvals', 'end']], 'Nothing to decide', true),
        ]),
      },
    },
  }
}

function byTypePage() {
  const requestsOf = filter => `(data.requests || []).filter(r => r.kind === 'file' && r.data && r.data.state !== 'archived' && r.data.type === e.path && (${filter})).length`
  const summary = `(data.types || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', required: e.data.requiredApprovers || 0, draft: ${requestsOf("(r.data.status || 'draft') === 'draft'")}, submitted: ${requestsOf("r.data.status === 'submitted'")}, approved: ${requestsOf("r.data.status === 'approved'")}, refused: ${requestsOf("r.data.status === 'refused'")}, cancelled: ${requestsOf("r.data.status === 'cancelled'")} }))`
  const rows = `{{ (data.summary || []).filter(t => state.showempty || t.draft + t.submitted + t.approved + t.refused + t.cancelled > 0).map(t => ({ path: t.path, code: t.code, name: t.name, required: t.required, draft: t.draft, submitted: t.submitted, approved: t.approved, refused: t.refused, cancelled: t.cancelled })) }}`
  return {
    file: 'by-type.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'approvals-by-type', name: 'Approvals by type', description: 'Requests per approval type and status.', icon: 'list-checks' },
      spec: {
        access: containerAccess('Count approval requests per type and status'),
        data: { ...requestSources, summary: { kind: 'computed', expr: summary } },
        state: { showempty: false },
        tree: page([
          row([
            column([heading('Approvals by type'), text('Every approval type with its threshold and its requests, counted by status.', 'muted')]),
            button('Approvals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'file-check'),
          ], 'between'),
          ...['requests', 'types'].map(name => status(name)[0]),
          stats([
            stat('Approval types', count('types'), 'list-checks', loading('types')),
            stat('Open requests', count('requests', "(e.data.status || 'draft') === 'draft' || e.data.status === 'submitted'"), 'hourglass', loading('requests')),
            stat('Decided', count('requests', "e.data.status === 'approved' || e.data.status === 'refused'"), 'check', loading('requests')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show types without requests', value: '{{ state.showempty }}' } },
          table(rows, [['code', 'Type'], ['name', 'Name'], ['required', 'Required', 'end'], ['draft', 'Draft', 'end'], ['submitted', 'Submitted', 'end'],
            ['approved', 'Approved', 'end'], ['refused', 'Refused', 'end'], ['cancelled', 'Cancelled', 'end']], 'No approval types', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), requestsPage(), pendingPage(), byTypePage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
