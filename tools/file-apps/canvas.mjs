// Build-time Canvas helpers shared by the generators of the file-based apps.
//
// How a generated app is put together:
// - `src/pages.mjs` builds each page and form from these helpers; `buildPages()` passes the result through
//   `appNavigation`, which gives every unbound page the app's sidebar, turns single-kind file browsers into record
//   tables and per-stage tabs into a Board / List pair.
// - `src/views.mjs` holds what the app adds on top: sidebar labels and counts, and the calendars, charts, boards
//   and strips drawn above or below a page's own content.
// - Record forms get the standard header, the lifecycle stepper and a deadline countdown from `recordHeader` and
//   `lifecycle`; `formControl` picks the control for a field definition.
// - `tools/file-apps/smoke-canvas.sh` renders every generated document in the Canvas runtime, empty and seeded.
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
export const openFile = (path, mode, open) => ({ 'open-file': { path, ...(mode ? { mode } : {}), ...(open ? { open } : {}) } })
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
/**
 * A table; `columns` are `[key, label, align?, format?]`. It searches, sorts and pages itself, and turns into a
 * two-line list when the pane is narrow. Clickable tables open `event.path` as a tab beside the list.
 */
export const table = (rows, columns, emptyText, clickable = false) => ({
  type: 'canvas.table',
  props: {
    rows,
    columns: columns.map(([key, label, align, format]) => ({ key, label, ...(align ? { align } : {}), ...(format ? { format } : {}) })),
    emptyText, search: true, sortable: true, pageSize: 25, narrow: 'list',
    ...(clickable ? { clickable: true } : {}),
  },
  ...(clickable ? { on: { 'row-click': [openFile('{{ event.path }}', 'edit', 'side')] } } : {}),
})
export const linkButton = (label, pathExpression, icon) =>
  button(label, [openFile(`{{ ${pathExpression} }}`, 'edit')], { visible: `!!(${pathExpression})` }, 'ghost', icon)

export function toneExpression(key, tones) {
  return `{{ ${Object.entries(tones).map(([tone, values]) => `${JSON.stringify(values)}.includes(form.values.${key}) ? '${tone}' : `).join('')}'neutral' }}`
}
export const humanize = key => `{{ String(form.values.${key} || '').split('-').join(' ') }}`

/**
 * The state of a data source, declared once: a skeleton while it loads, and a first-run, no-access or error
 * state when it cannot be read. `missing` says what to do when the source has nothing to read yet.
 */
export function status(source, missing) {
  return [{
    type: 'canvas.empty-state',
    props: { for: source, compact: true, ...(missing ? { description: missing } : {}) },
  }]
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
      // `details` lists what the script will write (a journal preview), under the message.
      // `fields` collect answers (a checklist of ticks, a reason); every required one must be given.
      ...(confirm ? [{ confirm: { title: confirm.title, message: confirm.message, ...(confirm.details ? { details: confirm.details } : {}), ...(confirm.fields ? { fields: confirm.fields } : {}) } }] : []),
      { 'run-script': { file: script, timeout: 120, parameters: { operation, path: '{{ ctx.file.path }}', ...parameters }, assign: 'lastresult' } },
      { 'refresh-source': { source: 'record' } },
      { toast: { message: "{{ (state.lastresult && state.lastresult.message) || 'Done' }}", variant: 'success' } },
    ],
  }
}

/** Whether another app offers an operation this document's app uses (`appops`: an `app-operations` source). */
export const offers = (app, operation) => `(data.appops || []).some(o => o.app === '${app}' && o.operation === '${operation}' && o.available)`

/** The `app-operations` source `offers` reads: the operations this app declares in its api.yaml `uses`. */
export const appOperationsSource = { appops: { kind: 'app-operations' } }

/**
 * The key of one attempt at a call. The platform replays a key for good: the same key returns the first execution
 * again, a failed one included, and the same key with other input is refused. So a key names an attempt (the record
 * plus the moment), never the record alone: a retry after a failure, or after the record changed, is a new attempt.
 * Running twice is harmless because every operation is idempotent by its source (a journal, a draft or a move is named
 * after the record it comes from).
 */
export const attemptKey = key => `{{ (${key}) + '-' + Date.now() }}`

/**
 * Steps that hand a request the app's own script returned (`state.<result>.<field>`) to another app's operation
 * through the platform (`call-app`), then record what came back with the app's own script (`recordOperation`, given
 * the operation's `path` as `parameter`). Nothing runs when the other app is not installed or nothing was requested.
 * `key` (an expression naming the record) keys the attempt (see `attemptKey`).
 */
export function callAppSteps({ app, operation, script, recordOperation, parameter = 'invoice', result = 'lastresult', field = 'invoiceRequest', key, path = '{{ ctx.file.path }}', recordParameters = {}, returned = 'path' }) {
  const requested = `${offers(app, operation)} && !!state.${result} && !!state.${result}.${field}`
  return [
    { 'call-app': { if: requested, app, operation, input: { $expr: `state.${result}.${field}` }, 'idempotency-key': attemptKey(key), assign: 'appcall' } },
    // `returned`: the field of the operation's result the app's script records (a path, or a list of paths).
    { 'run-script': { if: `${requested} && !!state.appcall && !!state.appcall.${returned}`, file: script, timeout: 120,
      parameters: { operation: recordOperation, path, [parameter]: `{{ state.appcall.${returned} }}`, ...recordParameters }, assign: 'recorded' } },
  ]
}

const also = (step, condition) => {
  const [type] = Object.keys(step)
  const body = step[type]
  return { [type]: { ...body, if: body.if ? `(${condition}) && (${body.if})` : condition } }
}

/**
 * A record action (the app's own script, `scriptAction`) followed by another app's operation (through its API) on
 * what the script returned (`field`), then the app's script recording the result (`recordOperation`). `key` (an
 * expression) names the record the attempt is keyed by.
 *
 * Optional (the default): without the other app installed only the record's own step runs, and the page offers the
 * follow-up again later. `required` (with the other app's `label`): the action is nothing without the other app (a
 * ledger posting), so when its operation is not available nothing runs at all and the user is told why, instead of a
 * half-done record under a success message.
 */
export function withAppCall(action, options) {
  const { required = false, label = options.app } = options
  const available = offers(options.app, options.operation)
  const steps = action.steps.filter(step => !step.toast && !step['refresh-source'])
  const requested = `!!state.lastresult && !!state.lastresult.${options.field ?? 'invoiceRequest'}`
  const done = { message: "{{ (state.recorded && state.recorded.message) || (state.lastresult && state.lastresult.message) || 'Done' }}", variant: 'success' }
  const body = [
    ...steps,
    ...callAppSteps(options),
    { 'refresh-source': { source: 'record' } },
  ]
  return {
    ...action,
    steps: [
      // Each run starts clean: an earlier action's result on this page is never read as this one's.
      { 'set-state': { key: 'lastresult', value: null } },
      { 'set-state': { key: 'appcall', value: null } },
      { 'set-state': { key: 'recorded', value: null } },
      ...(required ? [
        { toast: { if: `!(${available})`, variant: 'error',
          message: `${label} is not available right now, so nothing was done. Check that ${label} is installed and approved, then try again.` } },
        ...body.map(step => also(step, available)),
        // Done: the other app's result was recorded, or the script had nothing left to hand over (already done).
        { toast: { ...done, if: `(${available}) && (!(${requested}) || !!state.recorded)` } },
        { toast: { if: `(${available}) && ${requested} && !state.recorded`, variant: 'error', message: `${label} did not confirm this. Nothing was marked as done; try again.` } },
      ] : [
        ...body,
        // Without a recorded result the script had nothing to hand over, or the other app is not installed (the page
        // offers the follow-up again later). The other app's step failing stops the action with its error instead.
        { toast: done },
      ]),
    ],
  }
}

/** Whether the action just run finished the cross-app step, or had nothing left to hand over (already done). */
export const appCallSettled = field => `!!state.lastresult && (!state.lastresult.${field} || !!state.recorded)`

/** `withAppCall` for Invoicing drafting the record's invoice from its `invoiceRequest`; `record-invoice` stores it. */
export function withInvoice(action, { script, key, recordOperation = 'record-invoice', parameter = 'invoice', recordParameters }) {
  return withAppCall(action, { app: 'invoicing', operation: 'create-draft-invoice', script, recordOperation, parameter, key, recordParameters })
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
    // Rows of one shape are edited in place as a table. Amounts stay exact text: the scripts own the arithmetic.
    return { type: 'canvas.form.line-items', props: {
      ...props, columns: lineColumns(field.fields), defaultRow: field.defaultRow ?? {},
      storeComputed: false,
      ...(field.summary ? { summary: field.summary } : {}),
      ...(field.assert ? { assert: field.assert } : {}),
      minimum: field.minimum ?? 0, maximum: field.maximum ?? 1000, addLabel: field.addLabel ?? 'Add row',
    }, layout: { tablet: { colSpan: 2 } }, ...ruleProps }
  }
  // `on` handlers run after the binding writes the value (e.g. a picker that also fills a name).
  const control = (type, extra = {}) => ({ type, props: { ...props, ...extra }, ...layout, ...ruleProps, ...(field.on ? { on: field.on } : {}) })
  // A choice read from other records is searched as you type; a short fixed list is shown as segments.
  if (field.type === 'select') {
    const fixed = Array.isArray(field.options) ? field.options : null
    return control('canvas.form.select', {
      options: field.options,
      ...(!fixed ? { searchable: true } : {}),
      ...(fixed && fixed.length >= 2 && fixed.length <= 4 && fixed.every(option => String(option.label ?? option).length <= 14) ? { display: 'segmented' } : {}),
    })
  }
  if (field.type === 'checklist') {
    const checklist = { type: 'canvas.checklist', props: { ...props, items: field.items ?? [], ...(field.timers ? { timers: true } : {}), ...(field.touch ? { size: 'touch' } : {}) }, layout: { tablet: { colSpan: 2 } }, ...ruleProps }
    if (!field.live) return checklist
    // A live checklist is ticked while the rest of the record is locked (an order in production): each tick is
    // written to the record at once instead of waiting for Save. `live` is when it can be ticked.
    return {
      ...checklist,
      props: { ...checklist.props, value: `{{ form.values.${field.key} || [] }}` },
      rules: { ...(field.visible ? { visible: field.visible } : {}), disabled: `!(${field.live})` },
      on: { update: [
        { 'patch-record': { path: '{{ ctx.file.path }}', values: { [field.key]: { $expr: 'event' }, updatedAt: '{{ Date() }}' } } },
        { 'refresh-source': { source: 'record' } },
      ] },
    }
  }
  if (field.type === 'signature') return control('canvas.form.signature', field.signer ? { signer: field.signer } : {})
  if (field.type === 'photos') return { ...control('canvas.form.capture', { max: field.max ?? 6, size: field.size ?? 1024, quality: 0.75 }), layout: { tablet: { colSpan: 2 } } }
  if (field.type === 'address') return { ...control('canvas.form.address'), layout: { tablet: { colSpan: 2 } } }
  if (field.type === 'phone') return control('canvas.form.phone', field.defaultCode ? { defaultCode: field.defaultCode } : {})
  if (field.type === 'text-list') return control(/tags?$/i.test(field.key) ? 'canvas.form.tags' : 'canvas.form.text-list')
  // A text with a character limit (a social post) is plain text with a counter, never Markdown.
  if (field.type === 'textarea' && field.limit) return control('canvas.form.textarea', { rows: field.rows ?? 4, limit: field.limit })
  if (field.type === 'textarea' && /^(body|content|markdown|minutes|agenda)$/i.test(field.key)) return control('canvas.form.markdown', { rows: field.rows ?? 12 })
  // A small whole-number score is picked on a scale instead of typed.
  if (field.type === 'number' && /rating|score/i.test(field.key) && field.max >= 3 && field.max <= 10 && (field.step ?? 1) === 1) return control('canvas.form.rating', { max: field.max })
  if (field.type === 'number') return control('canvas.form.number', { min: field.min, max: field.max, step: field.step ?? 1 })
  if (field.type === 'date') return control('canvas.form.date')
  if (field.type === 'textarea') return control('canvas.form.textarea', { rows: field.rows ?? 4 })
  return control('canvas.form.input', field.type === 'email' ? { inputType: 'email' } : {})
}

/**
 * The columns of a line grid. Lines with a quantity and a unit price get a line total with a footer sum: a
 * display figure only, never stored; the posting scripts compute the amounts that count.
 */
export function lineColumns(fields) {
  const columns = fields.map(lineColumn)
  const quantity = fields.find(field => /^(quantity|qty)$/i.test(field.key))
  const price = fields.find(field => /^(unitPrice|price|rate)$/i.test(field.key))
  if (!quantity || !price) return columns
  const discount = fields.find(field => /^discount/i.test(field.key))
  const expr = `Number(row.${quantity.key} || 0) * Number(row.${price.key} || 0)${discount ? ` * (1 - Number(row.${discount.key} || 0) / 100)` : ''}`
  return [...columns, { key: 'lineTotal', label: 'Line total', type: 'computed', expr, decimals: 2, sum: true, align: 'right' }]
}

/** A `rows` field definition as a line-items column. */
export function lineColumn(field) {
  const choices = field.options ?? field.choices
  return {
    key: field.key, label: field.label ?? field.key,
    type: choices ? 'select' : 'text',
    ...(choices ? { options: choices } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.type === 'integer' ? { align: 'right' } : {}),
    // Whole-number columns are totalled. Amounts are exact decimal text owned by the scripts, so they are not.
    ...(/^(quantity|qty|hours|units|points)$/i.test(field.key) ? { align: 'right', sum: true } : {}),
    ...(/amount|price|total|rate|cost/i.test(field.key) ? { align: 'right' } : {}),
  }
}

/**
 * The standard top of a record form: title, the record's kind and code, status badges and the record buttons.
 * `badges` and `buttons` are ordinary nodes, so their rules and actions keep working.
 */
export function recordHeader(title, badges, subtitle, buttons) {
  return {
    type: 'canvas.record-header',
    props: { title, note: String(subtitle).split(' · {{ ctx.file.path }}').join('') },
    children: [
      ...(badges.length ? [row(badges)] : []),
      ...buttons.map(node => ({ ...node, slot: 'actions' })),
    ],
  }
}

/**
 * The top of a page: its title and one line about it, with the page's buttons on the right. `nodes` are the
 * heading and text nodes; `actions` are ordinary nodes (a row of buttons is unwrapped).
 */
export function pageHeader(nodes, actions = []) {
  const [title, note] = nodes
  const buttons = actions.flatMap(node => (node.type === 'canvas.stack' && !node.rules ? node.children : [node]))
  return {
    type: 'canvas.record-header',
    props: { title: title.props.text, ...(note ? { note: note.props.text } : {}) },
    children: buttons.map(node => ({ ...node, slot: 'actions' })),
  }
}

const terminalStates = ['cancelled', 'canceled', 'rejected', 'refused', 'lost', 'declined', 'void', 'voided', 'failed', 'no-show', 'not-held', 'terminated', 'retired', 'scrapped']

/**
 * The record's lifecycle as a stepper, when its status field offers a fixed list of values. States that end the
 * record early (cancelled, rejected…) are drawn as branches instead of steps.
 */
export function lifecycle(entity) {
  if (!entity?.status) return []
  const field = (entity.sections ?? []).flatMap(section => section.fields ?? []).find(candidate => candidate.key === entity.status)
  const options = Array.isArray(field?.options) ? field.options.filter(option => option && option.value !== undefined && option.value !== '') : []
  if (options.length < 2 || options.length > 8) return []
  const isBranch = option => terminalStates.includes(String(option.value))
  return [{
    type: 'canvas.status-steps',
    props: {
      value: `{{ form.values.${entity.status} }}`,
      steps: options.filter(option => !isBranch(option)).map(option => ({ value: option.value, label: option.label })),
      ...(options.some(isBranch) ? { branches: options.filter(isBranch).map(option => ({ value: option.value, label: option.label })) } : {}),
    },
    rules: { visible: `!!form.values.${entity.status}` },
  }, ...deadline(entity, options)]
}

const deadlineKeys = ['slaDeadline', 'deadline', 'dueDate', 'expectedDate', 'expectedCloseDate']
const finishedStates = ['done', 'closed', 'solved', 'resolved', 'received', 'delivered', 'posted', 'paid', 'applied', 'hired', 'validated', ...terminalStates]

/** A countdown to the record's deadline, while the record is still open. */
function deadline(entity, options) {
  const field = (entity.sections ?? []).flatMap(section => section.fields ?? []).find(candidate => deadlineKeys.includes(candidate.key))
  if (!field) return []
  const open = options.map(option => String(option.value)).filter(value => !finishedStates.includes(value))
  return [{
    type: 'canvas.meter',
    props: { kind: 'deadline', to: `{{ form.values.${field.key} }}`, label: field.label, thresholds: { warning: 0.75, danger: 1 } },
    rules: { visible: `!!form.values.${field.key} && ${JSON.stringify(open)}.includes(form.values.${entity.status})` },
  }]
}

const statusKeys = ['data.stage', 'data.status', 'data.state']

/**
 * A file browser over one record kind becomes a table of those records: it searches, sorts and pages itself,
 * offers its status as view tabs with counts, hides archived records, and opens a row beside the list.
 */
function recordList(node, spec) {
  const path = String(node.props.path).replace(/\/$/, '')
  const mime = node.props.mimeTypes?.[0]
  const name = `list${path.replace(/[^a-z0-9]/gi, '').toLowerCase()}`.slice(0, 40)
  spec.data = { ...spec.data, [name]: { kind: 'folder', path, contents: true, ...(mime ? { 'mime-pattern': mime } : {}) } }
  const columns = (node.props.columns ?? []).filter(column => typeof column === 'object')
  const facet = columns.find(column => statusKeys.includes(column.key))
  return [
    { type: 'canvas.empty-state', props: { for: name, compact: true } },
    {
      type: 'canvas.table',
      props: {
        rows: `{{ (data.${name} || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived') }}`,
        columns: columns.map(column => ({
          key: column.key === 'name' ? 'data.code' : column.key, label: column.label,
          ...(statusKeys.includes(column.key) || column.key === 'data.priority' ? { format: 'badge' } : {}),
          // A deadline shows as time left while the record is open, and as met once it is finished.
          ...(/deadline/i.test(column.key)
            ? { format: 'countdown', soon: '4h', ...(facet ? { doneWhen: `${JSON.stringify(finishedStates)}.includes(row.${facet.key})`, doneText: 'Done' } : {}) }
            : /(At|Date|date|Until|From|start|end)$/.test(column.key) ? { format: 'date' } : {}),
        })),
        ...(facet ? { facets: [facet.key] } : {}),
        search: true, sortable: true, pageSize: 25, narrow: 'list', clickable: true, rowKey: 'path',
        emptyText: node.props.emptyText ?? 'Nothing here yet',
      },
      rules: { visible: `data.$${name}.status === 'ready'` },
      on: { 'row-click': [openFile('{{ event.path }}', 'edit', 'side')] },
    },
  ]
}

const stageRows = /^\{\{ (.+)\.filter\((\w+) => \2\.(\w+) === '([^']+)'\) \}\}$/

/**
 * Tabs that hold one table per stage (the same rows, filtered by one field) become two views of those rows:
 * a board with a column per stage, and one list with the stages as view tabs. Cards and rows open the record
 * beside the page. The board is read-only: stage changes that run a script stay on the record's form.
 */
function stageViews(node) {
  if (node.type !== 'canvas.tabs' || (node.children ?? []).length < 3) return null
  const tables = node.children.map(panel => (panel.children?.length === 1 && panel.children[0].type === 'canvas.table' ? panel.children[0] : null))
  if (tables.some(table => !table)) return null
  const matches = tables.map(table => stageRows.exec(String(table.props.rows)))
  if (matches.some(match => !match) || new Set(matches.map(match => `${match[1]}|${match[3]}`)).size !== 1) return null
  const [, base, , key] = matches[0]
  const labels = Object.fromEntries(node.props.items.map((item, index) => [matches[index][4], item.label]))
  const columns = tables[0].props.columns
  const [code, title, ...rest] = columns
  const open = [openFile('{{ event.row.path }}', 'edit', 'side')]
  return {
    type: 'canvas.tabs',
    props: { variant: 'pill', persist: true, items: [{ value: 'board', label: 'Board', icon: 'kanban' }, { value: 'list', label: 'List', icon: 'list' }] },
    children: [
      { ...column([{
        type: 'canvas.board',
        props: {
          rows: `{{ ${base} }}`, groupBy: key, readOnly: true, rowKey: 'path',
          columns: matches.map(match => ({ value: match[4], label: labels[match[4]] })),
          card: { title: (title ?? code).key, code: code.key, meta: rest.slice(0, 3).map(column => column.key) },
          emptyText: 'Nothing here',
        },
        on: { open },
      }], 4), slot: 'board' },
      { ...column([{
        type: 'canvas.table',
        props: {
          rows: `{{ ${base} }}`,
          columns: [...columns, { key, label: 'Stage', format: 'badge', labels }],
          views: [{ value: 'all', label: 'All' }, ...matches.map(match => ({ value: match[4], label: labels[match[4]], where: `row.${key} === '${match[4]}'` }))],
          search: true, sortable: true, pageSize: 25, narrow: 'list', clickable: true, rowKey: 'path', emptyText: 'Nothing here',
        },
        on: { 'row-click': [openFile('{{ event.path }}', 'edit', 'side')] },
      }], 4), slot: 'list' },
    ],
  }
}

/** Says a record is archived and offers to restore it (the `restore` action of `baseActions`). */
export function archivedAlert(singular) {
  return {
    type: 'canvas.alert',
    props: { tone: 'warning', title: `This ${String(singular).toLowerCase()} is archived`, text: 'Restore it to edit.', icon: 'archive', action: { label: 'Restore', id: 'restore' } },
    rules: { visible: archived },
    on: { action: 'restore' },
  }
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
    text(description, 'muted'),
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
export function boundForm({ name, displayName, description, icon, mime, schemaId, schemaSource, access, data, state, roles, tree, actions }) {
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
      ...(roles ? { roles } : {}),
      // Every bound form lists its errors in one place; the summary hides itself while the form is valid.
      tree: page([{ type: 'canvas.validation-summary', props: { title: 'Fix these before saving' } }, ...(Array.isArray(tree) ? tree : [tree])]),
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

/** Whether a document needs the user's email or roles: it declares `roles`, or reads `ctx.can`, `ctx.user.email` or `ctx.user.roles`. */
export function usesUserProfile(spec) {
  if (spec.roles && Object.keys(spec.roles).length > 0) return true
  return /ctx\.(can\s*\(|user\s*\.\s*(email|roles)\b|user\s*\[\s*['"](email|roles)['"])/.test(JSON.stringify(spec))
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
      capabilities: [
        ...(rest.access?.length ? [] : ['file:read', ...(write ? ['file:write'] : [])]),
        // The signed-in user's email and workspace roles (ctx.can), as canvas `usesUserProfile` decides.
        ...(usesUserProfile(rest) ? ['user-profile'] : []),
      ],
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

const walkNodes = (nodes, visit) => {
  for (const node of nodes ?? []) {
    visit(node)
    walkNodes(node.children, visit)
  }
}
const pageTarget = step => step?.['open-file']?.path
const isNavigation = (node, files, root) => {
  const click = node.on?.click
  if (node.type !== 'canvas.button' || !Array.isArray(click) || click.length !== 1) return false
  const path = pageTarget(click[0])
  return typeof path === 'string' && path.startsWith(`${root}/canvas/`) && files.has(path.slice(`${root}/canvas/`.length))
}

/**
 * Gives every unbound page of an app the same sidebar: one item per page, plus Settings when the launch page
 * has a Settings button. The buttons that only moved between those pages are dropped from the page headers.
 * Widgets and bound forms are left alone. `views` holds what an app adds per page: `{ [file]: { label, icon,
 * count, tone, top, bottom, data, state, access, writes, moves } }`. `top` and `bottom` are nodes placed under the header and at
 * the end; `data` and `access` are the sources and folder grants those nodes need; `writes` are folders the page
 * changes records in; `moves` makes the page's board
 * movable (see `movableBoard`).
 */
export function appNavigation(pages, root, views = {}) {
  const unbound = Object.entries(pages).filter(([file, document]) =>
    !document.spec.binds?.length && file.endsWith('.page.yaml') && !file.includes('.widget.'))
  const home = unbound.find(([file]) => file === 'home.page.yaml') ?? unbound[0]
  if (!home || unbound.length === 0) return pages
  const files = new Set(unbound.map(([file]) => file))
  let settings
  walkNodes(home[1].spec.tree, (node) => {
    if (node.type === 'canvas.button' && node.props?.label === 'Settings' && Array.isArray(node.on?.click)) settings ??= node.on.click
  })
  const title = document => {
    let found
    walkNodes(document.spec.tree, (node) => { if (node.type === 'canvas.record-header') found ??= node.props?.title })
    return found ?? document.metadata.name
  }
  // A count is only shown on pages that load every source it reads.
  const sourced = (expression, spec) => [...String(expression).matchAll(/data\.(\w+)/g)].every(match => match[1] in (spec.data ?? {}))
  const navFor = spec => nav.map(({ count, tone, ...item }) => (count && sourced(count, spec) ? { ...item, count, ...(tone ? { tone } : {}) } : item))
  const nav = [
    ...[home, ...unbound.filter(entry => entry !== home)].map(([file, document]) => ({
      id: file,
      label: views[file]?.label ?? (file === home[0] ? 'Overview' : title(document)),
      icon: views[file]?.icon ?? (file === home[0] ? 'layout-dashboard' : iconName(document.metadata.icon ?? 'file')),
      ...(views[file]?.count ? { count: views[file].count } : {}),
      ...(views[file]?.tone ? { tone: views[file].tone } : {}),
    })),
    ...(settings ? [{ id: 'settings', label: 'Settings', icon: 'settings' }] : []),
  ]
  const result = { ...pages }
  for (const [file, document] of unbound) {
    const added = views[file] ?? {}
    // A view may bring its own sources and the folders they read; both become part of the page.
    const spec = {
      ...document.spec,
      ...(added.access ? { access: [...(document.spec.access ?? []), ...added.access] } : {}),
      ...(added.data ? { data: { ...document.spec.data, ...added.data } } : {}),
      ...(added.state ? { state: { ...document.spec.state, ...added.state } } : {}),
    }
    const lists = nodes => (nodes ?? []).flatMap((node) => {
      if (node.type === 'canvas.files' && node.props?.mimeTypes?.length === 1 && node.props.navigable === false) {
        return recordList(node, spec).map(part => (node.slot ? { ...part, slot: node.slot } : part))
      }
      const staged = stageViews(node)
      if (staged) return [staged]
      return [node.children ? { ...node, children: lists(node.children) } : node]
    })
    const strip = nodes => (nodes ?? [])
      .filter(node => !isNavigation(node, files, root) && !(settings && node.type === 'canvas.button' && node.props?.label === 'Settings'))
      .map(node => (node.children ? { ...node, children: strip(node.children) } : node))
    const extra = views[file] ?? {}
    const movable = nodes => (nodes ?? []).map((node) => {
      if (node.type === 'canvas.board' && extra.moves) return movableBoard(node, extra.moves, spec)
      return node.children ? { ...node, children: movable(node.children) } : node
    })
    // A board whose moves write the record directly, or a view that edits records in place (`writes`), needs to
    // write in the records' folder.
    const writable = new Map((extra.writes ?? []).map(path => [path, 'change records from this page']))
    if (extra.moves?.edit && extra.moves.container) writable.set(extra.moves.container, 'move records between columns')
    if (writable.size) {
      spec.access = (spec.access ?? []).map(grant => (writable.has(grant.path) && grant.mode !== 'write' ? { ...grant, mode: 'write', reason: `${grant.reason}; ${writable.get(grant.path)}` } : grant))
    }
    const body = lists(strip(document.spec.tree.length === 1 && document.spec.tree[0].type === 'canvas.stack' ? document.spec.tree[0].children : document.spec.tree))
    const headed = body[0]?.type === 'canvas.record-header' ? 1 : body[0]?.type === 'canvas.heading' ? (body[1]?.type === 'canvas.text' ? 2 : 1) : 0
    const children = movable([...body.slice(0, headed), ...(extra.top ?? []), ...body.slice(headed), ...(extra.bottom ?? [])])
    result[file] = {
      ...document,
      spec: {
        ...spec,
        tree: [{
          type: 'canvas.app-shell',
          props: { title: home[1].metadata.name, icon: iconName(home[1].metadata.icon ?? 'layout-grid'), active: file, nav: navFor(spec), page: true },
          on: { navigate: [
            { 'open-view': { if: "event.id != 'settings'", document: `${root}/canvas/{{ event.id }}`, open: 'replace' } },
            ...(settings ?? []).map(step => Object.fromEntries(Object.entries(step).map(([kind, body]) => [kind, { ...body, if: "event.id == 'settings'", ...(kind === 'open-file' ? { open: 'side' } : {}) }]))),
          ] },
          // The page's own stack is replaced by the shell's page layout, so its sections sit directly inside it.
          children,
        }],
      },
    }
  }
  return result
}

/** Opens the record a chart mark, calendar entry, board card or strip item stands for, beside the page. */
export const openRow = [{ 'open-file': { path: '{{ event.row.path }}', mode: 'edit', open: 'side' } }]

/** A calendar over dated rows. `options` are `canvas.calendar` props (`start`, `end`, `title`, `colorBy`, `view`…). */
export const calendar = (rows, options) => ({
  type: 'canvas.calendar', props: { rows, views: ['month', 'week', 'agenda'], showLegend: true, emptyText: 'Nothing scheduled', ...options }, on: { open: openRow },
})
/** A chart over rows. `options` are `canvas.chart` props (`kind`, `x`, `y`, `format`, `palette`…). */
export const chart = (rows, options) => ({ type: 'canvas.chart', props: { rows, showLegend: true, emptyText: 'Nothing to chart yet', ...options } })
/** Records on a now-relative axis: what is overdue, due soon and later. */
export const timeStrip = (rows, options) => ({ type: 'canvas.time-strip', props: { rows, emptyText: 'Nothing due', ...options }, on: { open: openRow } })
export const meter = options => ({ type: 'canvas.meter', props: options })
/** A board with a column per value of `groupBy`. */
export const board = (rows, groupBy, columns, cardProps, options = {}) => ({
  type: 'canvas.board', props: { rows, groupBy, columns, card: cardProps, readOnly: true, rowKey: 'path', emptyText: 'Nothing here', ...options }, on: { open: openRow },
})
/** One card per row. `children` see the row as `item`. */
export const repeat = (items, children, options = {}) => ({ type: 'canvas.repeat', props: { items, layout: 'grid', columns: 3, emptyText: 'Nothing here yet', ...options }, children })

/** A titled block of a page that is not a card: a heading, one line about it, and its content. */
export const section = (title, children, description) => ({
  type: 'canvas.stack', layout: { base: { gap: 2 } },
  children: [heading(title, 3), ...(description ? [text(description, 'muted')] : []), ...children],
})

/**
 * Makes a board's cards movable. `moves` says what a move into each column does:
 *
 * - `run`: columns reached by an operation of the app's action script (`{ solved: 'resolve' }`). The script
 *   checks the transition and writes the record, exactly as the form's button does. An operation that takes
 *   arguments is `{ operation, parameters }`; one that needs input first is `{ operation, ask: [fields] }`, which
 *   opens a dialog and passes the answers to the script under the same keys.
 * - `edit: true`: any other column sets `field` on the record directly, as editing the field on the form does.
 *   Without it, the other columns take no drops.
 * - `form`: columns that need input only the form can collect; they take no drops.
 * - `final`: cards in these columns stay put. Moving into one asks first (`confirm` adds a sentence).
 *
 * A failed move (the script refuses, a write fails, a confirmation is declined) puts the card back.
 */
export function movableBoard(node, moves, spec) {
  const groupBy = node.props.groupBy
  const prefix = groupBy.startsWith('data.') ? 'row.data.' : 'row.'
  const run = Object.fromEntries(Object.entries(moves.run ?? {}).map(([to, op]) => [to, typeof op === 'string' ? { operation: op } : op]))
  const final = moves.final ?? []
  const form = moves.form ?? []
  const reachable = value => !form.includes(value) && (value in run || moves.edit)
  const label = value => node.props.columns.find(column => column.value === value)?.label ?? value
  const code = node.props.card?.code ? `{{ event.row.${node.props.card.code} }}` : 'This record'
  const scripted = Object.keys(run)
  const isRun = `${JSON.stringify(scripted)}.includes(event.to)`
  const folders = Object.entries(spec.data ?? {}).filter(([, source]) => source.kind === 'folder').map(([name]) => name)
  const steps = [
    ...final.filter(to => reachable(to) && !run[to]?.ask?.length).map(to => ({
      confirm: {
        if: `event.to === '${to}'`,
        title: `Move to ${label(to)}?`,
        message: `${code} moves to ${label(to)}. ${moves.confirm?.[to] ?? 'It cannot be moved back from the board.'}`,
        'confirm-label': `Move to ${label(to)}`,
      },
    })),
    ...Object.entries(run).filter(([to]) => reachable(to)).flatMap(([to, { operation, parameters, ask, script, then = [] }]) => [
      ...(ask?.length
        ? [{ confirm: { if: `event.to === '${to}'`, title: `Move to ${label(to)}`, message: `${code} moves to ${label(to)}.`, 'confirm-label': `Move to ${label(to)}`, fields: ask, assign: 'moveanswer' } }]
        : []),
      {
        'run-script': {
          // A target may run its own script (`run: { to: { script, operation } }`); otherwise the board's.
          if: `event.to === '${to}'`, file: script ?? moves.script, timeout: 120,
          parameters: {
            operation, path: '{{ event.path }}', ...(parameters ?? {}),
            ...Object.fromEntries((ask ?? []).map(field => [field.key, `{{ state.moveanswer.${field.key} }}`])),
          },
          assign: 'lastmove',
        },
      },
      // Follow-up steps for this target (another app's operation, recording its result), only for this drop.
      ...then.map(step => {
        const [name, body] = Object.entries(step)[0]
        return { [name]: { ...body, if: body.if ? `event.to === '${to}' && (${body.if})` : `event.to === '${to}'` } }
      }),
    ]),
    ...(moves.edit
      ? [{ 'patch-record': { if: `!${isRun}`, path: '{{ event.path }}', values: { [moves.field]: '{{ event.to }}', updatedAt: '{{ Date() }}' } } }]
      : []),
    ...folders.map(source => ({ 'refresh-source': { source } })),
    { toast: { message: `{{ ${isRun} ? ((state.lastmove && state.lastmove.message) || 'Done') : 'Moved to ' + (${JSON.stringify(Object.fromEntries(node.props.columns.map(column => [column.value, column.label ?? column.value])))}[event.to] || event.to) }}`, variant: 'success' } },
  ]
  return {
    ...node,
    props: {
      ...node.props,
      readOnly: false,
      columns: node.props.columns.map(column => (reachable(column.value) ? column : { ...column, locked: true })),
      ...(final.length ? { lockedWhen: `${JSON.stringify(final)}.includes(${prefix}${groupBy.replace(/^data\./, '')})` } : {}),
    },
    on: { ...node.on, move: steps },
  }
}

/**
 * The print template of a sales or invoicing document: what the preview shows and `render-pdf` writes. Every
 * argument is an expression over `form.values` (and the form's sources). Drafts and cancelled records carry a
 * stamp, so a printed draft is never mistaken for the real thing.
 */
export function documentTemplate({ title, subtitle, party, partyLabel = 'For', meta = [], lines, columns, totals = [], footer, status = 'form.values.status' }) {
  return {
    title: `{{ ${title} }}`,
    ...(subtitle ? { subtitle: `{{ ${subtitle} }}` } : {}),
    ...(party ? { parties: { $expr: `[{ label: '${partyLabel}', lines: (${party}).filter(line => line) }]` } } : {}),
    meta: { $expr: `[${meta.map(([label, value]) => `{ label: '${label}', value: ${value} }`).join(', ')}]` },
    lines: { $expr: lines },
    columns,
    totals: { $expr: `[${totals.map(([label, value, strong]) => `{ label: ${label.includes('{{') || label.startsWith("'") ? label : `'${label}'`}, value: ${value}${strong ? ', strong: true' : ''} }`).join(', ')}]` },
    ...(footer ? { footer: `{{ ${footer} }}` } : {}),
    stamp: `{{ ['draft', 'cancelled'].includes(${status}) ? (${status} === 'draft' ? 'Draft' : 'Cancelled') : '' }}`,
  }
}

/** A record shown as the paper it becomes, in a card that opens on demand. */
export function documentPreview(options) {
  return {
    type: 'canvas.card',
    props: { title: 'Preview', description: 'How this looks printed or saved as PDF.', collapsible: true, defaultOpen: false },
    children: [{ type: 'canvas.document', props: documentTemplate(options) }],
  }
}

/**
 * Steps that save the document as a PDF in the record's documents folder. `immutable` (the issued copy) refuses to
 * replace a PDF that is already there; drafts are saved as `<code>-draft.pdf` and replaced on every save.
 */
export function pdfSteps(options, { immutable = false, suffix = immutable ? '' : '-draft' } = {}) {
  const name = `{{ form.values.code || 'document' }}${suffix}`
  return [
    { 'render-pdf': { template: { ...documentTemplate(options), page: { size: 'A4', margin: 18, footer: 'Page {page} of {pages}' } }, path: `./documents/${name}.pdf`, ...(immutable ? { immutable: true } : {}) } },
    { toast: { message: immutable ? 'Saved the issued copy in Documents' : 'Saved the PDF in Documents', variant: 'success' } },
  ]
}

/** The customer block of a sales or invoicing record: name, legal name, address lines, city, country, tax number. */
export const customerLines = "[form.values.customer && form.values.customer.name, form.values.customer && form.values.customer.legalName !== form.values.customer.name ? form.values.customer.legalName : ''].concat((form.values.customer && form.values.customer.address && form.values.customer.address.lines) || []).concat([form.values.customer && form.values.customer.address ? [form.values.customer.address.city, form.values.customer.address.postalCode].filter(part => part).join(' ') : '', form.values.customer && form.values.customer.address && form.values.customer.address.country, form.values.customer && form.values.customer.taxIdentifier ? 'Tax number ' + form.values.customer.taxIdentifier : '']).filter(line => line)"

/** The calling code for a party's phone numbers typed without one, from the party's country. */
export const callingCode = countryExpression => `{{ ({ ZA: '+27', NA: '+264', BW: '+267', ZW: '+263', MZ: '+258', LS: '+266', SZ: '+268', KE: '+254', NG: '+234', GB: '+44', IE: '+353', NL: '+31', DE: '+49', FR: '+33', US: '+1', CA: '+1', AU: '+61', NZ: '+64' })[${countryExpression}] || '' }}`

/**
 * A list page over a container's records: `rows` is an expression over `data.records` (the container's active
 * records, `{ path, name, data }`) mapped to table rows, each carrying the record's `path` so a row opens its form
 * beside the list. `columns` are `table` columns. `top` adds nodes above the table (stats, a calendar…), `extra`
 * more data sources. The page is unbound, so `appNavigation` adds it to the app's sidebar.
 */
export function listPage({ file, id, name, title = name, note, description, icon, container, mime, access, rows, columns, empty, top = [], extra = {}, state, clickable = true, permissions, me = false }) {
  const records = `(data.records || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')`
  if (me) {
    extra = { ...signedIn.data, ...extra }
    access = [...signedIn.access, ...(access ?? [])]
  }
  return {
    file,
    document: {
      'api-version': apiVersion, kind: 'Page',
      metadata: { id, name, description, icon },
      spec: {
        access: [{ path: container, reason: `List ${name.toLowerCase()}` }, ...(access ?? [])],
        data: { records: folder(container, mime), ...extra },
        ...(state ? { state } : {}),
        ...(permissions ? { permissions } : {}),
        tree: page([
          pageHeader([heading(title), text(note ?? description, 'muted')]),
          ...status('records'),
          ...top.map(node => JSON.parse(JSON.stringify(node).replaceAll('RECORDS', records.replaceAll('"', '\\"')))),
          table(`{{ ${rows.replaceAll('RECORDS', records)} }}`, columns, empty, clickable),
        ]),
      },
    },
  }
}

/** An Employees record's display name (`e`), including records written with given and family names. */
const employeeName = "String(e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' ') || '')"

/** The Employees app's directory, which other apps read when it is installed. */
export const employeeDirectory = { path: '/employees', mime: 'application/vnd.verentis.employees.employee+json' }

/**
 * Who the signed-in user is, as `data.me` = `{ path, name }`: their Employees record, found by its work email (the
 * host shares the email once the app declares `user-profile`, which the build adds), else just their sign-in name.
 * Spread `data` and `access` into a document, or pass `me: true` to `listPage`.
 */
export const signedIn = {
  data: {
    signedinstaff: folder(employeeDirectory.path, employeeDirectory.mime),
    me: {
      kind: 'computed',
      expr: "((data.signedinstaff || []).filter(e => e.kind === 'file' && e.data && e.data.status !== 'terminated' && !!ctx.user && !!ctx.user.email"
        + " && String(e.data.workEmail || '').toLowerCase() === String(ctx.user.email).toLowerCase()).map(e => ({ path: e.path, name: String(e.data.name || '') }))[0]"
        + " || { path: '', name: ctx.user ? String(ctx.user.name || '') : '' })",
    },
  },
  access: [{ path: employeeDirectory.path, reason: 'Find your Employees record by your work email (when Employees is installed)' }],
}

/**
 * Whether record `e` is the signed-in user's (needs `signedIn`): its employee link is their Employees record, or the
 * name on it is their employee name or sign-in name (case-insensitive). `refField` is optional.
 */
export function mine(nameField, refField) {
  const name = `String(e.data.${nameField} || '').toLowerCase()`
  const byRef = refField ? `(!!data.me && !!data.me.path && e.data.${refField} === data.me.path) || ` : ''
  return `(!!ctx.user && (${byRef}(${name} !== '' && [data.me ? data.me.name : '', String(ctx.user.name || '')].filter(n => !!n).map(n => n.toLowerCase()).includes(${name}))))`
}

/**
 * A record field that links a person to their Employees record (`refKey`, a path) beside the name it shows
 * (`nameKey`). Spread `sources.data`/`sources.access` into the form (they include `signedIn`); `field` is the picker,
 * which copies the chosen employee's name; `meButton` and `meAction` link the signed-in user's own record.
 * Without Employees installed the picker is empty and the name stays typed.
 */
export function employeeLink(refKey, nameKey, { label = 'Employee record', description = 'Optional. Choosing a record fills the name.', visible = 'true', disabled = 'form.saving' } = {}) {
  const nameOf = path => `((data.employeelinks || []).filter(e => e.kind === 'file' && e.data && e.path === ${path}).map(e => ${employeeName})[0] || form.values.${nameKey} || '')`
  const action = `link-me-${refKey.toLowerCase()}`
  return {
    sources: {
      data: {
        ...signedIn.data,
        employeelinks: folder(employeeDirectory.path, employeeDirectory.mime),
        employeelinkoptions: { kind: 'computed', expr: `(data.employeelinks || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && e.data.status !== 'terminated').map(e => ({ value: e.path, label: (${employeeName} || e.name) + (e.data.jobTitle ? ' · ' + e.data.jobTitle : '') }))` },
      },
      access: signedIn.access,
    },
    field: { key: refKey, label, type: 'select', options: '{{ data.employeelinkoptions }}', description,
      on: { update: [{ 'patch-form': { values: { [nameKey]: `{{ ${nameOf('event')} }}` } } }] } },
    meButton: button('This is me', action, {
      visible: `(${visible}) && !!data.me && !!data.me.path && form.values.${refKey} !== data.me.path`, disabled,
    }, 'ghost', 'user-check'),
    meAction: { [action]: { steps: [{ 'patch-form': { values: { [refKey]: '{{ data.me.path }}', [nameKey]: '{{ data.me.name }}' } } }] } },
  }
}

