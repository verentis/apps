// Build-time Canvas helpers shared by the file-based Accounting and Invoicing generators.
export const apiVersion = 'canvas.verentis.io/v1'
export const canvasOriginVariable = '${var:canvas-origin}'

export const archived = "form.values.state === 'archived'"

export const text = (value, tone) => ({ type: 'canvas.text', props: { text: value, ...(tone ? { tone } : {}) } })
export const heading = (value, level = 2) => ({ type: 'canvas.heading', props: { level, text: value } })
export const button = (label, click, rules, variant, icon) => ({
  type: 'canvas.button', props: { label, ...(variant ? { variant } : {}), ...(icon ? { icon } : {}), size: 'sm' }, on: { click }, ...(rules ? { rules } : {}),
})
export const row = (children, justify) => ({
  type: 'canvas.stack', layout: { base: { direction: 'row', wrap: true, gap: 2, align: 'center', ...(justify ? { justify } : {}) } }, children,
})
export const column = (children, gap = 1) => ({ type: 'canvas.stack', layout: { base: { gap } }, children })
export const card = (title, children, description) => ({
  type: 'canvas.card', props: { title, ...(description ? { description } : {}) }, children,
})
export const grid = (children, tablet = 2) => ({
  type: 'canvas.grid', layout: { base: { columns: 1, gap: 4 }, tablet: { columns: tablet } }, children,
})
export const tabs = (items, panels) => ({ type: 'canvas.tabs', props: { items }, children: panels })
export const panel = (slot, children) => ({ ...column(children, 4), slot })
export const page = children => [{
  type: 'canvas.stack',
  layout: { base: { padding: 6, gap: 4, maxWidth: '72rem', margin: { x: 'auto' } } },
  children,
}]
export const openFile = (path, mode) => ({ 'open-file': { path, ...(mode ? { mode } : {}) } })
export const iconName = icon => icon.replace(/^lucide:/, '')
export const badge = (value, tone, rules, icon) => ({
  type: 'canvas.dashboard.badge', props: { text: value, tone, ...(icon ? { icon } : {}) }, ...(rules ? { rules } : {}),
})
export const stat = (label, value, icon, loading) => ({
  type: 'canvas.dashboard.stat', props: { label, value, icon, ...(loading ? { loading } : {}) },
})
export const stats = (children, desktop = 4) => ({
  type: 'canvas.grid', layout: { base: { columns: 2, gap: 4 }, desktop: { columns: desktop } }, children,
})
/** A table; `columns` are `[key, label, align?]`. Clickable tables open `event.path` in its form. */
export const table = (rows, columns, emptyText, clickable = false) => ({
  type: 'canvas.table',
  props: { rows, columns: columns.map(([key, label, align]) => ({ key, label, ...(align ? { align } : {}) })), emptyText, ...(clickable ? { clickable: true } : {}) },
  ...(clickable ? { on: { 'row-click': [openFile('{{ event.path }}', 'edit')] } } : {}),
})
export const linkButton = (label, pathExpression, icon) =>
  button(label, [openFile(`{{ ${pathExpression} }}`, 'edit')], { visible: `!!(${pathExpression})` }, 'ghost', icon)

export function toneExpression(key, tones) {
  return `{{ ${Object.entries(tones).map(([tone, values]) => `${JSON.stringify(values)}.includes(form.values.${key}) ? '${tone}' : `).join('')}'neutral' }}`
}
export const humanize = key => `{{ String(form.values.${key} || '').split('-').join(' ') }}`

/** Loading and error notices of a data source. */
export function status(source, missing) {
  return [
    { ...text(missing ?? `{{ data.$${source}.error }}`), rules: { visible: `data.$${source}.status === 'error'` } },
    { ...text('Loading…', 'muted'), rules: { visible: `data.$${source}.status === 'loading'` } },
  ]
}

/** A folder source listing a container's direct children of one vendor MIME, with their parsed JSON. */
export const folder = (path, mime) => ({ kind: 'folder', path, contents: true, 'mime-pattern': mime })
export const jsonFile = path => ({ kind: 'file', path, parse: 'json' })

/** Select options over a folder source's active records: `CODE · label` → path. */
export function options(source, label, filter = 'true') {
  return `(data.${source} || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && (${filter})).map(e => ({ label: (e.data.code || e.name) + ' · ' + (${label}), value: e.path }))`
}

export const scriptPermissions = ['execution.run', 'execution.read']

/**
 * Runs one of the app's ledger scripts against the opened, saved record, then reloads it. The script reports a
 * `message`; failures surface as the action's error.
 */
export function scriptAction(script, operation, { confirm, parameters = {} }) {
  return {
    permissions: scriptPermissions,
    steps: [
      ...(confirm ? [{ confirm: { title: confirm.title, message: confirm.message } }] : []),
      { 'run-script': { file: script, timeout: 120, parameters: { operation, path: '{{ ctx.file.path }}', ...parameters }, assign: 'lastresult' } },
      { 'refresh-source': { source: 'record' } },
      { toast: { message: "{{ (state.lastresult && state.lastresult.message) || 'Done' }}", variant: 'success' } },
    ],
  }
}

/** A bound form control for one field definition. `readOnly` is an expression that disables the control. */
export function formControl(field, readOnly = archived) {
  const props = {
    label: field.label, value: `{{ form.values.${field.key} }}`,
    ...(field.required ? { required: true } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
  }
  const layout = field.span === 2 ? { layout: { tablet: { colSpan: 2 } } } : {}
  const disabled = [readOnly, field.readOnly].filter(Boolean).map(rule => `(${rule})`).join(' || ')
  const rules = {
    ...(disabled ? { disabled } : {}),
    ...(field.visible ? { visible: field.visible } : {}),
  }
  const ruleProps = Object.keys(rules).length ? { rules } : {}
  if (field.type === 'rows') {
    return { type: 'canvas.form.array', props: {
      ...props, fields: field.fields, defaultRow: field.defaultRow ?? {}, rowIds: false,
      minimum: field.minimum ?? 0, maximum: field.maximum ?? 1000, addLabel: field.addLabel ?? 'Add row', removeLabel: 'Remove row',
    }, ...layout, ...ruleProps }
  }
  const control = (type, extra = {}) => ({ type, props: { ...props, ...extra }, ...layout, ...ruleProps })
  if (field.type === 'select') return control('canvas.form.select', { options: field.options })
  if (field.type === 'text-list') return control('canvas.form.text-list')
  if (field.type === 'number') return control('canvas.form.number', { min: field.min, max: field.max, step: field.step ?? 1 })
  if (field.type === 'date') return control('canvas.form.date')
  if (field.type === 'textarea') return control('canvas.form.textarea', { rows: field.rows ?? 4 })
  return control('canvas.form.input', field.type === 'email' ? { inputType: 'email' } : {})
}

export const sectionCards = (sections, readOnly) =>
  sections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, readOnly)))], section.description))

export const saveSteps = (values = {}) => [
  { 'patch-form': { values: { updatedAt: '{{ Date() }}', ...values } } },
  { save: {} },
  { toast: { message: 'Saved', variant: 'success' } },
]

export const baseActions = {
  save: { steps: saveSteps() },
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

/**
 * Archive/Restore/Reset/Save buttons. `locked` is an expression for records the ledger made immutable: they
 * can be neither saved nor archived.
 */
export function recordButtons(locked = 'false') {
  return row([
    button('Archive', 'archive', { visible: `!(${archived}) && !(${locked})`, disabled: 'form.saving || form.dirty' }, 'ghost', 'archive'),
    button('Restore', 'restore', { visible: archived, disabled: 'form.saving || form.dirty' }, 'outline', 'archive-restore'),
    button('Reset', 'reset', { disabled: 'form.saving || !form.dirty' }, 'ghost'),
    button('Save', 'save', { disabled: `form.saving || !form.dirty || form.invalid || ${archived} || (${locked})` }, undefined, 'save'),
  ])
}

/** Files of any type stored in `<record>/documents/`. */
export function documentsPanel(description) {
  return panel('documents', [
    text(`${description} Files live in {{ ctx.file.path }}/documents.`, 'muted'),
    row([button('Open in Files', [openFile('{{ ctx.file.path }}/documents')], undefined, 'outline', 'folder-open')]),
    { type: 'canvas.files', props: { path: './documents/', columns: ['name', 'type', 'size', 'modified'], emptyText: 'No documents yet' } },
  ])
}

/** A native file browser over a container, listing one record kind. */
export function browser(path, mime, columns, emptyText) {
  return {
    type: 'canvas.files',
    props: { path: `${path}/`, mimeTypes: [mime], showFolders: false, navigable: false, columns, emptyText },
  }
}

/** A bound, editable form for one vendor MIME, validated against the installed JSON Schema. */
export function boundForm({ name, displayName, description, icon, mime, schemaId, schemaSource, access, data, state, tree, actions }) {
  return {
    'api-version': apiVersion, kind: 'Form',
    metadata: { id: name, name: displayName, description, icon },
    spec: {
      binds: [{
        pattern: mime, mode: 'edit', priority: 200, scope: 'global',
        'json-schema': { id: schemaId, source: schemaSource, title: displayName, version: '1' },
      }],
      ...(access?.length ? { access } : {}),
      data: { record: { kind: 'document', consistency: 'conditional' }, ...data },
      ...(state ? { state } : {}),
      tree: page(tree),
      actions,
    },
  }
}

const sandbox = { 'allow-scripts': true, 'allow-same-origin': true, 'allow-popups': false, 'allow-forms': true }

export function collectSteps(spec) {
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
      // Documents that declare access get their confined token from the platform broker, not a blanket capability.
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
 * The Canvas documents' `spec.access` as the app manifest's `spec.file-access`, each stamped with the document it
 * belongs to. Bound documents register under their `metadata.id`; unbound ones by their path under the install root.
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
