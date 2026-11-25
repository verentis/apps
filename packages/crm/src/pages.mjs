import { views } from './views.mjs'
import { activityKinds, childFolders, childKinds, containers, documentsFolder, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, templates } from './contracts.mjs'
import { entities, followUpsWidgetFile, followUpWindowDays, settingsFields } from './app.mjs'

import { appNavigation, lifecycle } from '../../../tools/file-apps/canvas.mjs'
const apiVersion = 'canvas.verentis.io/v1'
export const canvasOriginVariable = '${var:canvas-origin}'

// The Canvas expression language has no UUID helper, so new record IDs are built from Math.random as UUID v4.
export const uuidExpression = "Array.from('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx', c => c === 'x' ? Math.floor(Math.random() * 16).toString(16) : (c === 'y' ? (8 + Math.floor(Math.random() * 4)).toString(16) : c)).join('')"
// Same UTC stamp as the create script (`20260102-093005`), so children sort chronologically by name.
export const stampExpression = "Date().slice(0, 19).split('-').join('').split(':').join('').split('T').join('-')"

const archived = "form.values.state === 'archived'"
const live = "(state.showarchived || e.data.state !== 'archived')"

const text = (value, tone) => ({ type: 'canvas.text', props: { text: value, ...(tone ? { tone } : {}) } })
const heading = (value, level = 2) => ({ type: 'canvas.heading', props: { level, text: value } })
const button = (label, click, rules, variant, icon) => ({
  type: 'canvas.button', props: { label, ...(variant ? { variant } : {}), ...(icon ? { icon } : {}), size: 'sm' }, on: { click }, ...(rules ? { rules } : {}),
})
const row = (children, justify) => ({
  type: 'canvas.stack', layout: { base: { direction: 'row', wrap: true, gap: 2, align: 'center', ...(justify ? { justify } : {}) } }, children,
})
const column = (children, gap = 1) => ({ type: 'canvas.stack', layout: { base: { gap } }, children })
const card = (title, children, description) => ({
  type: 'canvas.card', props: { title, ...(description ? { description } : {}) }, children,
})
const grid = (children, tablet = 2) => ({
  type: 'canvas.grid', layout: { base: { columns: 1, gap: 4 }, tablet: { columns: tablet } }, children,
})
const tabs = (items, panels) => ({
  type: 'canvas.tabs', props: { items }, children: panels,
})
const panel = (slot, children) => ({ ...column(children, 4), slot })
const page = children => [{
  type: 'canvas.stack',
  layout: { base: { padding: 6, gap: 4, maxWidth: '72rem', margin: { x: 'auto' } } },
  children,
}]
const openFile = (path, mode) => ({ 'open-file': { path, ...(mode ? { mode } : {}) } })
const iconName = icon => icon.replace(/^lucide:/, '')

const statusTones = {
  success: ['customer', 'won', 'sent', 'received', 'held', 'completed', 'resolved', 'closed'],
  warning: ['prospect', 'pending', 'in-progress', 'planned', 'draft', 'deferred', 'new'],
  danger: ['lost', 'not-held', 'cancelled', 'urgent'],
  info: ['open', 'partner', 'supplier', 'not-started'],
}
const toneExpression = key => `{{ ${Object.entries(statusTones).map(([tone, values]) => `${JSON.stringify(values)}.includes(form.values.${key}) ? '${tone}' : `).join('')}'neutral' }}`
const humanize = key => `{{ String(form.values.${key} || '').split('-').join(' ') }}`

// The state of a data source, declared once: a skeleton while it loads, and a first-run, no-access or error
// state when it cannot be read.
function status(source, missing) {
  return [{ type: 'canvas.empty-state', props: { for: source, compact: true, ...(missing ? { description: missing } : {}) } }]
}

function folder(path, kind) {
  return { kind: 'folder', path, contents: true, 'mime-pattern': mimeTypes[kind] }
}

const recordLabel = "e.data.name || [e.data.salutation, e.data.givenName, e.data.familyName].filter(Boolean).join(' ').trim() || e.data.code || e.name"
const options = (source, filter = 'true') =>
  `(data.${source} || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && (${filter})).map(e => ({ label: (e.data.code ? e.data.code + ' · ' : '') + (${recordLabel}), value: e.path }))`

/** A table of records from a folder source that reference `refKey === <path expression>`. */
function referencingTable(source, refKey, pathExpression, columns, mapping, emptyText) {
  return {
    type: 'canvas.table',
    props: {
      rows: `{{ (data.${source} || []).filter(e => e.kind === 'file' && e.data && ${live} && e.data.${refKey} && e.data.${refKey}.path === ${pathExpression}).map(e => ({ path: e.path, code: e.data.code || e.name, ${mapping} })) }}`,
      columns: [{ key: 'code', label: 'Code' }, ...columns.map(([key, label]) => ({ key, label }))],
      emptyText, clickable: true, search: true, sortable: true, pageSize: 25, narrow: 'list',
    },
    // A related record opens as a tab beside this one.
    on: { 'row-click': [{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }] },
  }
}

const createPermissions = ['file.write']

// write-file content is a string, so the record template becomes one object-literal expression;
// `{{ placeholder }}` strings map to scope expressions and everything else is a JSON literal.
function templateExpression(value, bindings) {
  if (Array.isArray(value)) return `[${value.map(item => templateExpression(item, bindings)).join(', ')}]`
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${templateExpression(item, bindings)}`).join(', ')} }`
  }
  const placeholder = typeof value === 'string' && value.match(/^\{\{ (\w+) \}\}$/)
  if (placeholder) {
    if (!(placeholder[1] in bindings)) throw new Error(`Unbound template placeholder ${value}`)
    return bindings[placeholder[1]]
  }
  if (typeof value === 'string' && value.includes('{{')) throw new Error(`Unsupported template placeholder in ${value}`)
  return JSON.stringify(value)
}

/**
 * Writes a new communication or note beneath the opened record, laid out exactly as the create script lays it
 * out (`<record>/<folder>/<stamp>-<kind>.json`, with `regarding`), then opens it in its own form.
 */
function createChildAction(kind) {
  const path = `{{ ctx.file.path }}/${childFolders[kind]}/{{ state.newstamp }}-${kind}.json`
  const template = { ...templates[kind], regarding: { path: '{{ record }}' } }
  return {
    permissions: createPermissions,
    steps: [
      { 'set-state': { key: 'newid', value: { $expr: uuidExpression } } },
      { 'set-state': { key: 'newat', value: { $expr: 'Date()' } } },
      { 'set-state': { key: 'newstamp', value: { $expr: stampExpression } } },
      { 'write-file': {
        path, mime: mimeTypes[kind],
        content: `{{ JSON.stringify(${templateExpression(template, { id: 'state.newid', now: 'state.newat', name: "''", record: 'ctx.file.path' })}, null, 2) }}`,
      } },
      openFile(path, 'edit'),
    ],
  }
}

function formControl(field, readOnly = archived) {
  const props = {
    label: field.label, value: `{{ form.values.${field.key} }}`,
    ...(field.required ? { required: true } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
  }
  const layout = field.span === 2 ? { layout: { tablet: { colSpan: 2 } } } : {}
  const rules = {
    ...(readOnly ? { disabled: readOnly } : {}),
    ...(field.visible ? { visible: field.visible } : {}),
  }
  const ruleProps = Object.keys(rules).length ? { rules } : {}
  if (field.type === 'rows') {
    return { type: 'canvas.form.array', props: {
      ...props, fields: field.fields, defaultRow: field.defaultRow ?? {}, rowIds: false,
      minimum: field.minimum ?? 0, maximum: field.maximum ?? 1000, addLabel: 'Add row', removeLabel: 'Remove row',
    }, ...layout }
  }
  const control = (type, extra = {}) => ({ type, props: { ...props, ...extra }, ...layout, ...ruleProps })
  if (field.type === 'select') return control('canvas.form.select', { options: field.options })
  if (field.type === 'text-list') return control('canvas.form.text-list')
  if (field.type === 'number') return control('canvas.form.number', { min: field.min, max: field.max, step: field.step ?? 1 })
  if (field.type === 'date') return control('canvas.form.date')
  if (field.type === 'datetime') return control('canvas.form.date', { mode: 'datetime-local' })
  if (field.type === 'textarea') return control('canvas.form.textarea', { rows: field.rows ?? 4 })
  return control('canvas.form.input', field.type === 'email' ? { inputType: 'email' } : {})
}

const editable = field => field.type !== 'reference'
const sectionCards = sections => sections.map(section => card(section.title, [grid(section.fields.filter(editable).map(field => formControl(field)))]))

const baseActions = {
  save: { steps: [
    { 'patch-form': { values: { updatedAt: '{{ Date() }}' } } },
    { save: {} },
    { toast: { message: 'Saved', variant: 'success' } },
  ] },
  reset: { steps: [{ 'reset-form': {} }] },
  archive: { steps: [
    { confirm: { title: 'Archive', message: 'Archive this record? It stays in the workspace and can be restored.' } },
    { 'patch-form': { values: { state: 'archived', archivedAt: '{{ Date() }}', updatedAt: '{{ Date() }}' } } },
    { save: {} },
    { toast: { message: 'Archived', variant: 'success' } },
  ] },
  restore: { steps: [
    { 'patch-form': { values: { state: 'active', updatedAt: '{{ Date() }}' } } },
    { save: {} },
    { toast: { message: 'Restored', variant: 'success' } },
  ] },
}

const recordButtons = row([
  button('Archive', 'archive', { visible: `!(${archived})`, disabled: 'form.saving || form.dirty' }, 'ghost', 'archive'),
  button('Restore', 'restore', { visible: archived, disabled: 'form.saving || form.dirty' }, 'outline', 'archive-restore'),
  button('Reset', 'reset', { disabled: 'form.saving || !form.dirty' }, 'ghost'),
  button('Save', 'save', { disabled: `form.saving || !form.dirty || form.invalid || ${archived}` }, undefined, 'save'),
])

const showArchived = {
  type: 'canvas.form.switch', props: { label: 'Show archived', value: '{{ state.showarchived }}' },
}

const typeLabels = Object.fromEntries(childKinds.map(kind => [mimeTypes[kind], entities[kind].singular]))
const valueLabels = { 'data.status': { 'not-started': 'Not started', 'in-progress': 'In progress', 'not-held': 'Not held' } }

/** A native file browser over one of the record's child folders. */
function childBrowser(folderName, kinds, extra = {}) {
  return {
    type: 'canvas.files',
    props: {
      path: `./${folderName}/`,
      mimeTypes: kinds.map(kind => mimeTypes[kind]),
      showFolders: false, navigable: false,
      columns: [{ key: 'data.subject', label: 'Subject' }, { key: 'type', label: 'Type' }, { key: 'data.status', label: 'Status' }, { key: 'modified', label: 'Updated' }],
      typeLabels, valueLabels, sort: 'name', descending: true,
      emptyText: `No ${kinds.length === 1 ? entities[kinds[0]].plural.toLowerCase() : 'activity'} yet`,
      ...extra,
    },
  }
}

/** Emails, calls, meetings, tasks, notes and documents stored beneath the opened record. */
function childTabs() {
  const actions = Object.fromEntries(childKinds.map(kind => [`new-${kind}`, createChildAction(kind)]))
  const newButtons = row(activityKinds.map(kind =>
    button(entities[kind].singular, `new-${kind}`, { disabled: archived }, 'outline', iconName(entities[kind].icon))))
  const activityViews = [
    ['all', 'All', activityKinds],
    ...activityKinds.map(kind => [kind, entities[kind].plural, [kind]]),
  ]
  const items = [
    { value: 'timeline', label: 'Timeline', icon: 'history' },
    { value: 'activities', label: 'Activities', icon: 'calendar-check' },
    { value: 'notes', label: 'Notes', icon: 'sticky-note' },
    { value: 'documents', label: 'Documents', icon: 'paperclip' },
  ]
  const panels = [
    panel('timeline', [{
      type: 'canvas.timeline',
      props: { sources: timelineSources, facets: true, limit: 50, emptyText: 'No activity yet', emptyDescription: 'Emails, calls, meetings, tasks and notes on this record appear here by date.' },
      on: { open: [openFile('{{ event.path }}')] },
    }]),
    panel('activities', [
      row([text('New', 'muted'), newButtons]),
      tabs(activityViews.map(([value, label]) => ({ value, label })), activityViews.map(([value, , kinds]) =>
        panel(value, [childBrowser(childFolders[kinds[0]], kinds)]))),
    ]),
    panel('notes', [
      row([button('Note', 'new-note', { disabled: archived }, 'outline', 'sticky-note')]),
      childBrowser(childFolders.note, ['note'], { columns: [{ key: 'data.title', label: 'Title' }, { key: 'modified', label: 'Updated' }], emptyText: 'No notes yet' }),
    ]),
    panel('documents', [
      text(`Files of any type in {{ ctx.file.path }}/${documentsFolder}. Upload or create them from Files.`, 'muted'),
      row([
        // Picked files are written into the record's documents folder as they are.
        { type: 'canvas.form.file-upload', props: { label: 'Add files', multiple: true }, rules: { disabled: archived },
          on: { files: [
            { 'for-each': { items: '{{ event }}', as: 'picked', steps: [{ 'write-file': { path: `{{ ctx.file.path }}/${documentsFolder}/{{ picked.name }}`, content: '{{ picked }}' } }] } },
            { toast: { message: 'Added to Documents', variant: 'success' } },
          ] } },
        button('Open in Files', [openFile(`{{ ctx.file.path }}/${documentsFolder}`)], undefined, 'outline', 'folder-open'),
      ]),
      { type: 'canvas.files', props: { path: `./${documentsFolder}/`, columns: ['name', 'type', 'size', 'modified'], emptyText: 'No documents yet' } },
    ]),
  ]
  const data = {
    activityfiles: { kind: 'folder', path: `{{ ctx.file.path }}/${childFolders.email}`, contents: true },
    notefiles: folder(`{{ ctx.file.path }}/${childFolders.note}`, 'note'),
  }
  return { items, panels, actions, data }
}

// The record's activities and notes as one dated feed, newest first.
const ofKind = (source, kind) => `(data.${source} || []).filter(e => e.kind === 'file' && e.data && e.mimeType === '${mimeTypes[kind]}' && e.data.state !== 'archived')`
const timelineSources = [
  { type: 'email', label: 'Emails', icon: 'mail', rows: `{{ ${ofKind('activityfiles', 'email')}.map(e => ({ path: e.path, title: e.data.subject, at: e.data.sentAt || e.data.createdAt || e.modified, subtitle: e.data.direction === 'inbound' ? 'From ' + (e.data.from || '') : 'Sent', status: e.data.status })) }}`, date: 'at', title: 'title', subtitle: 'subtitle', badge: 'status' },
  { type: 'call', label: 'Calls', icon: 'phone', rows: `{{ ${ofKind('activityfiles', 'call')}.map(e => ({ path: e.path, title: e.data.subject, at: e.data.startsAt || e.data.createdAt || e.modified, subtitle: e.data.result || '', status: e.data.status })) }}`, date: 'at', title: 'title', subtitle: 'subtitle', badge: 'status' },
  { type: 'meeting', label: 'Meetings', icon: 'calendar-days', rows: `{{ ${ofKind('activityfiles', 'meeting')}.map(e => ({ path: e.path, title: e.data.subject, at: e.data.startsAt || e.data.createdAt || e.modified, subtitle: e.data.location || '', status: e.data.status })) }}`, date: 'at', title: 'title', subtitle: 'subtitle', badge: 'status' },
  { type: 'task', label: 'Tasks', icon: 'square-check', rows: `{{ ${ofKind('activityfiles', 'task')}.map(e => ({ path: e.path, title: e.data.subject, at: e.data.dueDate || e.data.createdAt || e.modified, subtitle: e.data.priority || '', status: e.data.status })) }}`, date: 'at', title: 'title', subtitle: 'subtitle', badge: 'status' },
  { type: 'note', label: 'Notes', icon: 'sticky-note', rows: `{{ ${ofKind('notefiles', 'note')}.map(e => ({ path: e.path, title: e.data.title, at: e.data.updatedAt || e.data.createdAt || e.modified })) }}`, date: 'at', title: 'title' },
]

const customerSources = {
  companies: folder(containers.customers.path, 'company'),
  contacts: folder(containers.customers.path, 'contact'),
  customeroptions: { kind: 'computed', expr: `${options('companies')}.concat(${options('contacts')})` },
  contactoptions: { kind: 'computed', expr: options('contacts', "!form.values.customer || !form.values.customer.path || (e.data.company && e.data.company.path === form.values.customer.path) || e.path === form.values.customer.path") },
}

const dealColumns = [['title', 'Title'], ['stage', 'Stage'], ['amount', 'Amount'], ['outcome', 'Outcome']]
const dealMapping = "title: e.data.title, stage: e.data.stageId, amount: [e.data.currency, Number(e.data.amount || 0).toFixed(2)].filter(Boolean).join(' '), outcome: e.data.outcome"
const caseColumns = [['subject', 'Subject'], ['status', 'Status'], ['priority', 'Priority']]
const caseMapping = 'subject: e.data.subject, status: e.data.status, priority: e.data.priority'

/** Kind-specific data sources, tabs, header links and access grants of a record form. */
function recordExtras(kind) {
  if (kind === 'company' || kind === 'contact') {
    const relatedBy = kind === 'company' ? 'customer' : 'contact'
    const relatedTabs = [
      ...(kind === 'company' ? [{ value: 'contacts', label: 'Contacts', icon: 'users' }] : []),
      { value: 'deals', label: 'Deals', icon: 'handshake' },
      { value: 'cases', label: 'Cases', icon: 'life-buoy' },
    ]
    return {
      access: [
        { path: containers.customers.path, reason: 'List the contacts and companies of this customer' },
        { path: containers.deals.path, reason: 'Show this customer\'s deals' },
        { path: containers.cases.path, reason: 'Show this customer\'s cases' },
      ],
      data: {
        ...(kind === 'company'
          ? { contacts: folder(containers.customers.path, 'contact') }
          : { companies: folder(containers.customers.path, 'company'), companyoptions: { kind: 'computed', expr: options('companies') } }),
        deals: folder(containers.deals.path, 'deal'),
        cases: folder(containers.cases.path, 'case'),
      },
      links: kind === 'contact'
        ? [button('Company', [openFile('{{ form.values.company.path }}', 'edit')], { visible: '!!(form.values.company && form.values.company.path)' }, 'ghost', 'building-2')]
        : [],
      relatedTabs,
      relatedPanels: [
        ...(kind === 'company' ? [panel('contacts', [...status('contacts'), referencingTable('contacts', 'company', 'ctx.file.path',
          [['name', 'Name'], ['email', 'Email'], ['jobTitle', 'Job title']],
          "name: [e.data.givenName, e.data.familyName].filter(Boolean).join(' '), email: e.data.email || '', jobTitle: e.data.jobTitle || ''", 'No contacts yet. Create one from New › Contact in /customers.')])] : []),
        panel('deals', [...status('deals'), referencingTable('deals', relatedBy, 'ctx.file.path', dealColumns, dealMapping, 'No deals yet')]),
        panel('cases', [...status('cases'), referencingTable('cases', relatedBy, 'ctx.file.path', caseColumns, caseMapping, 'No cases yet')]),
      ],
    }
  }
  if (kind === 'deal' || kind === 'case') {
    return {
      access: [
        { path: containers.customers.path, reason: 'Pick the customer and contact' },
        ...(kind === 'deal' ? [{ path: settingsPath, reason: 'Read the pipeline stages' }] : []),
      ],
      data: {
        ...customerSources,
        ...(kind === 'deal'
          ? {
              settings: { kind: 'file', path: settingsPath, parse: 'json' },
              stageoptions: { kind: 'computed', expr: '((data.settings && data.settings.stages) || []).slice().sort((a, b) => a.order - b.order).map(stage => ({ label: stage.label, value: stage.id }))' },
            }
          : {}),
      },
      notices: kind === 'deal' ? status('settings', `CRM settings could not be read from ${settingsPath}. Pipeline stages are unavailable.`) : [],
      links: [
        button('Customer', [openFile('{{ form.values.customer.path }}', 'edit')], { visible: '!!(form.values.customer && form.values.customer.path)' }, 'ghost', 'building-2'),
        button('Contact', [openFile('{{ form.values.contact.path }}', 'edit')], { visible: '!!(form.values.contact && form.values.contact.path)' }, 'ghost', 'user'),
      ],
      actions: {
        save: { steps: [
          { 'patch-form': { values: kind === 'deal'
            ? { updatedAt: '{{ Date() }}', closedAt: "{{ form.values.outcome !== 'open' ? (form.values.closedAt || Date()) : undefined }}" }
            : { updatedAt: '{{ Date() }}', resolvedAt: "{{ ['resolved', 'closed'].includes(form.values.status) ? (form.values.resolvedAt || Date()) : undefined }}" } } },
          { save: {} },
          { toast: { message: 'Saved', variant: 'success' } },
        ] },
      },
    }
  }
  return {
    links: [button('{{ form.values.regarding && form.values.regarding.path ? form.values.regarding.path.split(\'/\').pop() : \'Record\' }}',
      [openFile('{{ form.values.regarding.path }}', 'edit')], { visible: '!!(form.values.regarding && form.values.regarding.path)' }, 'ghost', 'corner-left-up')],
    ...(kind === 'task'
      ? { actions: { save: { steps: [
        { 'patch-form': { values: {
          updatedAt: '{{ Date() }}',
          completedAt: "{{ form.values.status === 'completed' ? (form.values.completedAt || Date()) : undefined }}",
        } } },
        { save: {} },
        { toast: { message: 'Saved', variant: 'success' } },
      ] } } }
      : {}),
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const isRecord = recordKinds.includes(kind)
  const children = isRecord ? childTabs() : null
  const title = entity.title ?? `form.values.${entity.titleKey}`
  // The standard record header; badges and buttons are ordinary nodes, so their rules and actions keep working.
  const header = {
    type: 'canvas.record-header',
    props: {
      title: `{{ ${title} || 'New ${entity.singular.toLowerCase()}' }}`,
      note: isRecord ? `${entity.singular} {{ form.values.code || '' }}` : entity.singular,
    },
    children: [
      row([
        ...(entity.status ? [{ type: 'canvas.dashboard.badge', props: { text: humanize(entity.status), tone: toneExpression(entity.status) }, rules: { visible: `!!form.values.${entity.status}` } }] : []),
        { type: 'canvas.dashboard.badge', props: { text: 'Archived', tone: 'warning', icon: 'archive' }, rules: { visible: archived } },
      ]),
      { ...recordButtons, slot: 'actions' },
    ],
  }
  const overview = [
    ...(extras.links?.length ? [row(extras.links)] : []),
    ...(extras.notices ?? []),
    grid(sectionCards(entity.sections), isRecord ? 2 : 1),
  ]
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    {
      type: 'canvas.alert',
      props: { tone: 'warning', title: `This ${entity.singular.toLowerCase()} is archived`, text: 'Restore it to edit.', icon: 'archive', action: { label: 'Restore', id: 'restore' } },
      rules: { visible: archived },
      on: { action: 'restore' },
    },
    ...(isRecord
      ? [tabs(
          [{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...children.items.slice(0, 1), ...(extras.relatedTabs ?? []), ...children.items.slice(1)],
          [panel('overview', overview), ...children.panels, ...(extras.relatedPanels ?? [])],
        ), ...(extras.relatedTabs ? [showArchived] : [])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: {
      'api-version': apiVersion, kind: 'Form',
      metadata: { id: `crm-${kind}`, name: `CRM ${entity.singular.toLowerCase()}`, description: `View and edit a CRM ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon) },
      spec: {
        binds: [{
          pattern: mimeTypes[kind], mode: 'edit', priority: 200, scope: 'global',
          'json-schema': { id: schemaId(kind), source: `${installRoot}/schemas/${kind}.schema.json`, title: `CRM ${entity.singular.toLowerCase()}`, version: '1' },
        }],
        ...(extras.access ? { access: [...extras.access, { path: `${installRoot}/`, reason: 'Read the CRM schemas' }] } : {}),
        data: { record: { kind: 'document', consistency: 'conditional' }, ...extras.data, ...children?.data },
        state: { showarchived: false },
        tree: page([{ type: 'canvas.validation-summary', props: { title: 'Fix these before saving' } }, ...tree]),
        actions: { ...baseActions, ...extras.actions, ...children?.actions },
      },
    },
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: {
      'api-version': apiVersion, kind: 'Form',
      metadata: { id: 'crm-settings', name: 'CRM settings', description: 'Edit the CRM settings file.', icon: 'settings' },
      spec: {
        binds: [{
          pattern: mimeTypes.settings, mode: 'edit', priority: 200, scope: 'global',
          'json-schema': { id: schemaId('settings'), source: `${installRoot}/schemas/settings.schema.json`, title: 'CRM settings', version: '1' },
        }],
        data: { settings: { kind: 'document', consistency: 'conditional' } },
        tree: page([
          row([
            column([heading('CRM settings'), text('Defaults for new deals and the pipeline stages deal forms offer. Code prefixes are app settings, managed with the installed app.', 'muted')]),
            row([
              button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
              button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
            ]),
          ], 'between'),
          ...status('settings'),
          card('Settings', [grid(settingsFields.map(field => formControl(field, null)))]),
        ]),
      },
    },
  }
}

function homePage() {
  const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
  const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
  const loading = source => `{{ data.$${source}.status === 'loading' }}`
  const pipeline = `{{ (data.deals || []).filter(e => ${active} && e.data.outcome === 'open').reduce((sum, e) => sum + Number(e.data.amount || 0) * (e.data.probability == null ? 1 : e.data.probability / 100), 0).toFixed(2) }}`
  const browser = (path, kind, columns, extra = {}) => ({
    type: 'canvas.files',
    props: { path: `${path}/`, mimeTypes: [mimeTypes[kind]], showFolders: false, navigable: false, columns, emptyText: `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${path}.`, ...extra },
  })
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': apiVersion, kind: 'Page',
      metadata: { id: 'crm-home', name: 'CRM', description: 'CRM overview.', icon: 'contact' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          { path: containers.customers.path, reason: 'List customers and contacts' },
          { path: containers.deals.path, reason: 'List deals and the pipeline' },
          { path: containers.cases.path, reason: 'List cases' },
        ],
        data: {
          companies: folder(containers.customers.path, 'company'),
          contacts: folder(containers.customers.path, 'contact'),
          deals: folder(containers.deals.path, 'deal'),
          cases: folder(containers.cases.path, 'case'),
        },
        tree: page([
          row([
            column([heading('CRM'), text('Customers, contacts, deals and cases are files in your workspace. Emails, calls, meetings, tasks, notes and documents live beneath the record they belong to.', 'muted')]),
            row([
              button('Customers', [openFile(containers.customers.path)], undefined, 'outline', 'building-2'),
              button('Deals', [openFile(containers.deals.path)], undefined, 'outline', 'handshake'),
              button('Cases', [openFile(containers.cases.path)], undefined, 'outline', 'life-buoy'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          { type: 'canvas.grid', layout: { base: { columns: 2, gap: 4 }, desktop: { columns: 5 } }, children: [
            { type: 'canvas.dashboard.stat', props: { label: 'Customers', value: count('companies'), icon: 'building-2', loading: loading('companies') } },
            { type: 'canvas.dashboard.stat', props: { label: 'Contacts', value: count('contacts'), icon: 'user', loading: loading('contacts') } },
            { type: 'canvas.dashboard.stat', props: { label: 'Open deals', value: count('deals', "e.data.outcome === 'open'"), icon: 'handshake', loading: loading('deals') } },
            { type: 'canvas.dashboard.stat', props: { label: 'Weighted pipeline', value: pipeline, icon: 'trending-up', loading: loading('deals') } },
            { type: 'canvas.dashboard.stat', props: { label: 'Open cases', value: count('cases', "!['resolved', 'closed'].includes(e.data.status)"), icon: 'life-buoy', loading: loading('cases') } },
          ] },
          ...Object.entries({ companies: 'customers', deals: 'deals', cases: 'cases' }).map(([source, name]) =>
            status(source, `The ${containers[name].path} folder could not be read. Reinstall CRM to recreate it.`)[0]),
          tabs([
            { value: 'customers', label: 'Customers', icon: 'building-2' },
            { value: 'contacts', label: 'Contacts', icon: 'user' },
            { value: 'deals', label: 'Deals', icon: 'handshake' },
            { value: 'cases', label: 'Cases', icon: 'life-buoy' },
          ], [
            panel('customers', [browser(containers.customers.path, 'company', [{ key: 'name', label: 'Code' }, { key: 'data.name', label: 'Name' }, { key: 'data.type', label: 'Relationship' }, { key: 'data.email', label: 'Email' }])]),
            panel('contacts', [browser(containers.customers.path, 'contact', [{ key: 'name', label: 'Code' }, { key: 'data.givenName', label: 'Given name' }, { key: 'data.familyName', label: 'Family name' }, { key: 'data.email', label: 'Email' }])]),
            panel('deals', [browser(containers.deals.path, 'deal', [{ key: 'name', label: 'Code' }, { key: 'data.title', label: 'Title' }, { key: 'data.stageId', label: 'Stage' }, { key: 'data.amount', label: 'Amount', align: 'end' }, { key: 'data.outcome', label: 'Outcome' }])]),
            panel('cases', [browser(containers.cases.path, 'case', [{ key: 'name', label: 'Code' }, { key: 'data.subject', label: 'Subject' }, { key: 'data.status', label: 'Status' }, { key: 'data.priority', label: 'Priority' }])]),
          ]),
        ]),
      },
    },
  }
}

const sandbox = { 'allow-scripts': true, 'allow-same-origin': true, 'allow-popups': false, 'allow-forms': true }

function collectSteps(spec) {
  const steps = Object.values(spec.actions ?? {}).flatMap(action => action.steps)
  const visit = nodes => {
    for (const node of nodes ?? []) {
      for (const handler of Object.values(node.on ?? {})) if (Array.isArray(handler)) steps.push(...handler)
      visit(node.children)
    }
  }
  visit(spec.tree)
  return steps
}

/**
 * Mirrors the Canvas designer's save-time projection of `spec.binds` and `spec.access` (canvas
 * `projectPlatformManifest`) so the installed documents register as viewers/editors without a designer save.
 */
export function projectRegistration(document, documentPath) {
  const { binds, ...rest } = document.spec
  if (!binds?.length) return document
  const write = binds.some(bind => bind.mode === 'edit') || (rest.access ?? []).some(grant => grant.mode === 'write')
  const permissions = ['file.read', ...(write ? ['file.write'] : [])]
  for (const action of Object.values(rest.actions ?? {})) {
    for (const permission of action.permissions ?? []) if (!permissions.includes(permission)) permissions.push(permission)
  }
  const scopes = ['self', 'subtree', 'global']
  const scope = binds.reduce((widest, bind) => scopes.indexOf(bind.scope ?? 'subtree') > scopes.indexOf(widest) ? bind.scope ?? 'subtree' : widest, 'self')
  return {
    ...document,
    spec: {
      binds,
      entry: `${canvasOriginVariable}/render?document=${encodeURIComponent(documentPath)}`,
      scope,
      'mime-types': binds.map(bind => ({
        pattern: bind.pattern, mode: bind.mode, priority: bind.priority ?? 200,
        ...(bind['json-schema'] ? { 'json-schema': { ...bind['json-schema'] } } : {}),
      })),
      permissions,
      // Like Canvas: documents that declare access get their confined token from the platform broker, so no
      // blanket file capability (which used to ask the host for a workspace-wide token).
      capabilities: rest.access?.length ? [] : ['file:read', ...(write ? ['file:write'] : [])],
      sandbox: { ...sandbox },
      ...(rest.access?.length
        ? { 'file-access': rest.access.map(grant => ({ path: grant.path, mode: grant.mode ?? 'read', ...(grant.reason ? { reason: grant.reason } : {}) })) }
        : {}),
      ...rest,
    },
  }
}

/**
 * The workspace dashboard widget (`spec.widgets`): what needs a follow-up — open cases by priority and open deals whose
 * expected close date has passed or falls within the next few days.
 */
function followUpsWidget() {
  const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
  const today = 'Date().slice(0, 10)'
  const horizon = `Date(Date.now() + ${followUpWindowDays} * 86400000).slice(0, 10)`
  // Overdue deals first, then cases by priority with deals closing soon between high and normal priority cases.
  const priorityRank = "({ urgent: 1, high: 2, normal: 4, low: 5 }[e.data.priority] ?? 4)"
  const cases = `(data.cases || []).filter(e => ${active} && !['resolved', 'closed'].includes(e.data.status)).map(e => ({ kind: 'case', path: e.path, code: e.data.code || e.name, title: e.data.subject || '', due: String(e.data.priority || 'normal') + ' priority', rank: ${priorityRank}, date: e.data.createdAt || '' }))`
  const deals = `(data.deals || []).filter(e => ${active} && e.data.outcome === 'open' && !!e.data.expectedCloseDate && e.data.expectedCloseDate <= ${horizon}).map(e => ({ kind: 'deal', path: e.path, code: e.data.code || e.name, title: e.data.title || '', due: e.data.expectedCloseDate < ${today} ? 'closes ' + e.data.expectedCloseDate + ' · overdue' : 'closes ' + e.data.expectedCloseDate, rank: e.data.expectedCloseDate < ${today} ? 0 : 3, date: e.data.expectedCloseDate }))`
  const items = '(data.followups || [])'
  return {
    file: followUpsWidgetFile,
    document: {
      'api-version': apiVersion, kind: 'Page',
      metadata: { id: 'crm-follow-ups-widget', name: 'Follow-ups', description: 'Open cases and deals closing soon, for the workspace dashboard.', icon: 'bell-ring' },
      spec: {
        access: [
          { path: containers.deals.path, reason: 'Show open deals that are due to close' },
          { path: containers.cases.path, reason: 'Show open cases' },
        ],
        data: {
          deals: folder(containers.deals.path, 'deal'),
          cases: folder(containers.cases.path, 'case'),
          followups: { kind: 'computed', expr: `${cases}.concat(${deals}).sort((a, b) => a.rank - b.rank || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))` },
        },
        tree: [column([
          row([
            column([
              heading('Follow-ups', 3),
              text(`{{ ${items}.filter(f => f.kind === 'case').length }} open cases · {{ ${items}.filter(f => f.kind === 'deal').length }} deals closing`, 'muted'),
            ]),
            button('CRM', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'contact'),
          ], 'between'),
          ...['deals', 'cases'].map(source => status(source)[0]),
          { ...text('Loading…', 'muted'), rules: { visible: "data.$deals.status === 'loading' || data.$cases.status === 'loading'" } },
          {
            type: 'canvas.table',
            props: {
              rows: `{{ ${items}.map(f => ({ path: f.path, code: f.code, title: f.title, due: f.due })) }}`,
              columns: [{ key: 'code', label: 'Ref' }, { key: 'title', label: 'Follow up' }, { key: 'due', label: 'Due' }],
              emptyText: 'Nothing to follow up', clickable: true,
            },
            on: { 'row-click': [openFile('{{ event.path }}', 'edit')] },
          },
        ], 2)],
      },
    },
  }
}

export function buildPages() {
  const documents = [
    homePage(),
    followUpsWidget(),
    ...[...recordKinds, ...childKinds].map(recordForm),
    settingsForm(),
  ]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}

/**
 * The Canvas documents' `spec.access` as the app manifest's `spec.file-access`, each stamped with the document it
 * belongs to, so the install consent covers what the forms may read or write. Bound documents register under their
 * `metadata.id`; unbound ones (the launch page) are identified by their path under the install root.
 */
export function documentFileAccess(pages) {
  return Object.entries(pages).flatMap(([file, document]) => {
    const id = document.spec.binds?.length ? document.metadata.id : `canvas/${file}`
    return (document.spec.access ?? []).map(grant => ({
      path: grant.path,
      mode: grant.mode ?? 'read',
      ...(grant.reason ? { reason: grant.reason } : {}),
      origin: { kind: 'document', id },
    }))
  })
}

export { collectSteps }
