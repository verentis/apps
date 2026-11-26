// Generates the Spreadsheet BI Canvas documents: a bound form per record kind, the settings form, the dashboards
// list (launch page), the live dashboard viewer and the snapshots list. Tile values are computed live by Canvas
// expressions over the source containers; freezing them is done by the take-snapshot script the snapshot form runs.
// Spreadsheet *editing* belongs to the platform's Office integration — these pages only view computed values.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, sourceContainers } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['taken'], warning: ['draft'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Spreadsheet BI schemas and run the snapshot script' }
const taken = "form.values.status === 'taken'"
const idle = 'form.saving || form.dirty'

const dashboardSources = {
  dashboards: folder(containers.dashboards.path, mimeTypes.dashboard),
  dashboardoptions: { kind: 'computed', expr: options('dashboards', "e.data.name || ''") },
}
const dashboardsAccess = reason => ({ path: containers.dashboards.path, reason })

/** `data.<key>` source key of a source container path (`/invoices` → `invoices`). */
const sourceKey = path => path.slice(1).replace(/[^a-z0-9]/gi, '')

// ---- The live tile computation, shared by the viewer page (over `data`) and the snapshot form's results table.
// Canvas expressions have only floats, so amounts (exact decimal strings in files) are summed as integer
// ten-thousandths and divided only for display.
const get = (object, path) => `String(${path} || '').split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), ${object})`
const groupKey = value => `(${value} === undefined || ${value} === null || ${value} === '' ? '(none)' : String(${value}))`
const sourcesMap = `({ ${sourceContainers.map(path => `'${path}': data.${sourceKey(path)}`).join(', ')} })`
const filterKeeps = `(!c.t.filter || !c.t.filter.field || String(${get('x.data', 'c.t.filter.field')}) === String(c.t.filter.equals === undefined || c.t.filter.equals === null ? '' : c.t.filter.equals))`
const tileNote = `(${JSON.stringify(sourceContainers)}.indexOf(c.t.source) < 0 ? 'Source ' + (c.t.source || '(none)') + ' is not readable from this viewer; tile skipped.' : (!Array.isArray(c.entries) ? 'Container ' + c.t.source + ' is unavailable; tile skipped. Is its app installed?' : ''))`
const tileItems = `(Array.isArray(c.entries) ? c.entries : []).filter(x => x.kind === 'file' && x.data && x.data.state !== 'archived').filter(x => ${filterKeeps}).map(x => ({ key: ${groupKey(get('x.data', 'c.t.groupByField'))}, raw: ${get('x.data', 'c.t.valueField')} }))`
const sumUnits = items => `${items}.reduce((m, i) => m + Math.round(Number(i.raw) * 10000), 0)`
const shownSum = items => `(${sumUnits(items)} / 10000).toFixed(2)`
const rowOf = (detail, value, note) => `({ title: s.c.t.title || '', kind: s.c.t.kind || '', detail: ${detail}, value: ${value}, note: ${note} })`
const skippedNote = `(s.c.items.length > s.numeric.length ? (s.c.items.length - s.numeric.length) + ' non-numeric value(s) skipped' : '')`
const grouped = value => `(s.keys.length ? s.keys.map(k => ${value}) : [${rowOf("''", "'0'", "'No matching records.'")}])`

/** Flattened viewer rows: one row per plain tile, one row per group of a group tile, notes for skipped tiles. */
const tileRows = tiles => `${tiles}.slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))`
  + `.map(t => ({ t: t, entries: ${sourcesMap}[t.source] }))`
  + `.map(c => ({ t: c.t, note: ${tileNote}, items: ${tileItems} }))`
  + `.map(c => ({ c: c, numeric: c.items.filter(i => (typeof i.raw === 'number' || typeof i.raw === 'string') && i.raw !== '' && Number.isFinite(Number(i.raw))), keys: c.items.map(i => i.key).filter((v, idx, a) => a.indexOf(v) === idx).sort() }))`
  + `.reduce((all, s) => all.concat(`
  + `s.c.note ? [${rowOf("''", "''", 's.c.note')}] : `
  + `s.c.t.kind === 'count' ? [${rowOf("''", 'String(s.c.items.length)', "''")}] : `
  + `s.c.t.kind === 'sum' ? [${rowOf("''", shownSum('s.numeric'), skippedNote)}] : `
  + `s.c.t.kind === 'group-count' ? ${grouped(rowOf('k', 'String(s.c.items.filter(i => i.key === k).length)', "''"))} : `
  + `s.c.t.kind === 'group-sum' ? ${grouped(rowOf('k', shownSum('s.numeric.filter(i => i.key === k)'), skippedNote))} : `
  + `[${rowOf("''", "''", "'Unknown tile kind ' + JSON.stringify(s.c.t.kind || '') + '; tile skipped.'")}]), [])`

const tileColumns = [['title', 'Tile'], ['kind', 'Kind'], ['detail', 'Group'], ['value', 'Value', 'end'], ['note', 'Note']]

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'dashboard') return tileBuilder()
  const resultRows = `(form.values.results || []).reduce((all, r) => all.concat(r.groups && r.groups.length`
    + ` ? r.groups.map(g => ({ title: r.title || '', detail: g.key || '', value: g.value === undefined ? '' : g.value, note: r.note || '' }))`
    + ` : [{ title: r.title || '', detail: '', value: r.value === undefined ? '' : r.value, note: r.note || '' }]), [])`
  // The snapshot's dashboard computed live now, to set beside the frozen values.
  const dashboardTiles = `(((data.dashboards || []).find(e => e.path === form.values.dashboard) || {}).data || {}).tiles || []`
  const compared = `${resultRows}.map(r => ({ title: r.title, detail: r.detail, then: r.value,`
    + ` now: ((data.liverows || []).find(l => l.title === r.title && String(l.detail || '') === String(r.detail || '')) || {}).value }))`
    + `.map(r => ({ title: r.title, detail: r.detail, then: r.then, now: r.now === undefined ? '—' : r.now,`
    + ` change: r.now === undefined || r.then === '' || !Number.isFinite(Number(r.then)) || !Number.isFinite(Number(r.now)) ? '' : (Number(r.now) - Number(r.then) > 0 ? '+' : '') + (Math.round((Number(r.now) - Number(r.then)) * 100) / 100) }))`
  return {
    access: [dashboardsAccess('Choose the dashboard a snapshot computes'), schemaAccess,
      ...sourceContainers.map(path => ({ path, reason: `Compare the frozen values with ${path} now (when the owning app is installed)` }))],
    data: {
      ...dashboardSources,
      ...Object.fromEntries(sourceContainers.map(path => [sourceKey(path), { kind: 'folder', path, contents: true }])),
      liverows: { kind: 'computed', expr: tileRows(`(${dashboardTiles})`) },
      compared: { kind: 'computed', expr: compared },
    },
    notices: [
      { ...text('This snapshot was taken at {{ form.values.takenAt }} and is locked.', 'muted'), rules: { visible: taken } },
    ],
    buttons: [
      button('Take snapshot', 'take-snapshot', { visible: `!(${taken}) && !(${archived})`, disabled: `${idle} || !form.values.dashboard` }, undefined, 'camera'),
    ],
    actions: {
      'take-snapshot': scriptAction(postScriptPath, 'take-snapshot', {
        confirm: { title: 'Take snapshot', message: 'Compute every tile of the dashboard now and lock the results into this snapshot?' },
      }),
    },
    panels: [card('Results', [
      table(`{{ ${resultRows} }}`, [['title', 'Tile'], ['detail', 'Group'], ['value', 'Value', 'end'], ['note', 'Note']], 'No results yet. Take the snapshot to compute them.'),
    ]), { ...card('Compared with live', [
      text('The frozen values next to what the same tiles show now, computed from the source containers as this page loads.', 'muted'),
      table('{{ data.compared }}', [['title', 'Tile'], ['detail', 'Group'], ['then', 'Then', 'end'], ['now', 'Now', 'end'], ['change', 'Change', 'end']], 'Nothing to compare yet.'),
    ]), rules: { visible: taken } }],
    locked: taken,
  }
}


/**
 * The dashboard form's "Add tile" builder: a wizard in a side sheet. The field pickers read the chosen source's
 * own records, and the last step previews the tile with live values before it is added to the tiles below.
 */
function tileBuilder() {
  const entries = `(${'({ ' + sourceContainers.map(path => `'${path}': data.${sourceKey(path)}`).join(', ') + ' })'}[state.draft.source] || [])`
  const records = `${entries}.filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')`
  const pick = path => `${path}.split('.').reduce((v, k) => (v == null ? v : v[k]), e.data)`
  // Field paths found in the source's records, one level into nested objects (totals.gross).
  const fieldPaths = `${records}.slice(0, 50).map(e => e.data).reduce((all, r) => all.concat(Object.keys(r).filter(k => !['$schema', 'schemaVersion', 'id', 'kind', 'state', 'createdAt', 'updatedAt'].includes(k)).reduce((ks, k) => ks.concat(r[k] && typeof r[k] === 'object' && !Array.isArray(r[k]) ? Object.keys(r[k]).map(sub => k + '.' + sub) : Array.isArray(r[k]) ? [] : [k]), [])), []).filter((k, i, all) => all.indexOf(k) === i).sort()`
  const numeric = `${fieldPaths}.filter(f => ${records}.some(e => ${pick('f')} !== '' && ${pick('f')} != null && Number.isFinite(Number(${pick('f')}))))`
  const filtered = `${records}.filter(e => !state.draft.filterField || String(${pick('state.draft.filterField')}) === String(state.draft.filterEquals))`
  const grouped = `${filtered}.map(e => String(${pick('state.draft.groupByField')} ?? '')).filter((k, i, all) => all.indexOf(k) === i).map(k => ({ label: k || '(none)', value: ${filtered}.filter(e => String(${pick('state.draft.groupByField')} ?? '') === k).reduce((s, e) => s + (state.draft.kind === 'group-sum' ? Number(${pick('state.draft.valueField')}) || 0 : 1), 0) }))`
  const single = `(state.draft.kind === 'sum' ? ${filtered}.reduce((s, e) => s + (Number(${pick('state.draft.valueField')}) || 0), 0) : ${filtered}.length)`
  const needsValue = "['sum', 'group-sum'].includes(state.draft.kind)"
  const needsGroup = "['group-count', 'group-sum'].includes(state.draft.kind)"
  const draft = { source: '', kind: 'count', valueField: '', groupByField: '', title: '', filterField: '', filterEquals: '' }
  const select = (label, key, options, extra = {}) => ({ type: 'canvas.form.select', props: { label, value: `{{ state.draft.${key} }}`, options, ...extra } })
  return {
    access: [schemaAccess, ...sourceContainers.map(path => ({ path, reason: `Offer the fields of ${path} and preview tiles (when the owning app is installed)` }))],
    data: Object.fromEntries(sourceContainers.map(path => [sourceKey(path), { kind: 'folder', path, contents: true }])),
    state: { builder: false, step: 'source', draft },
    notices: [{
      type: 'canvas.dialog',
      props: { open: '{{ state.builder }}', title: 'Add tile', description: 'Pick a source, what to show, and check the preview.', placement: 'side', size: 'lg' },
      on: { close: [{ 'set-state': { key: 'builder', value: false } }] },
      children: [{
        type: 'canvas.wizard',
        props: {
          step: '{{ state.step }}', finishLabel: 'Add tile',
          steps: { $expr: `[{ value: 'source', label: 'Source', valid: !!state.draft.source, reason: 'Choose a source' }, { value: 'show', label: 'What to show', valid: (!(${needsValue}) || !!state.draft.valueField) && (!(${needsGroup}) || !!state.draft.groupByField), reason: 'Choose the fields this kind needs' }, { value: 'check', label: 'Name and check', valid: !!String(state.draft.title || '').trim(), reason: 'Give the tile a title' }]` },
        },
        on: {
          change: [{ 'set-state': { key: 'step', value: '{{ event.step }}' } }],
          cancel: [{ 'set-state': { key: 'builder', value: false } }],
          finish: [
            { 'patch-form': { values: { tiles: { $expr: "(form.values.tiles || []).concat([{ sequence: String((form.values.tiles || []).reduce((m, t) => Math.max(m, Number(t.sequence) || 0), 0) + 1), title: String(state.draft.title).trim(), source: state.draft.source, kind: state.draft.kind, valueField: state.draft.valueField, groupByField: state.draft.groupByField, filter: { field: state.draft.filterField, equals: state.draft.filterEquals } }])" } } } },
            { 'set-state': { key: 'builder', value: false } },
            { toast: { message: 'Tile added. Save the dashboard to keep it.', variant: 'success' } },
          ],
        },
        children: [
          { ...column([
            select('Source', 'source', `{{ ${JSON.stringify(sourceContainers)}.map(path => ({ value: path, label: path, description: (({ ${sourceContainers.map(path => `'${path}': data.${sourceKey(path)}`).join(', ')} })[path] || []).filter(e => e.kind === 'file').length + ' records' })) }}`, { display: 'cards' }),
            { ...text('This source has no records yet, or its app is not installed.', 'muted'), rules: { visible: `!!state.draft.source && ${records}.length === 0` } },
          ], 3), slot: 'step:source' },
          { ...column([
            select('Kind', 'kind', [{ value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'group-count', label: 'Count per group' }, { value: 'group-sum', label: 'Sum per group' }], { display: 'segmented' }),
            { ...select('Value to add up', 'valueField', `{{ ${numeric}.map(f => ({ value: f, label: f })) }}`, { searchable: true, description: 'Fields whose values are numbers.' }), rules: { visible: needsValue } },
            { ...select('Group by', 'groupByField', `{{ ${fieldPaths}.map(f => ({ value: f, label: f })) }}`, { searchable: true }), rules: { visible: needsGroup } },
          ], 3), slot: 'step:show' },
          { ...column([
            { type: 'canvas.form.input', props: { label: 'Title', value: '{{ state.draft.title }}', required: true, placeholder: 'Open invoices by customer' } },
            grid([
              select('Only where', 'filterField', `{{ [{ value: '', label: 'Every record' }].concat(${fieldPaths}.map(f => ({ value: f, label: f }))) }}`, { searchable: true }),
              { type: 'canvas.form.input', props: { label: 'equals', value: '{{ state.draft.filterEquals }}' }, rules: { visible: '!!state.draft.filterField' } },
            ]),
            heading('Preview', 3),
            { type: 'canvas.dashboard.stat', props: { label: "{{ state.draft.title || 'Tile' }}", value: `{{ format(${single}, 'number') }}`, hint: `{{ ${filtered}.length + ' records' }}` }, rules: { visible: `!(${needsGroup})` } },
            { type: 'canvas.chart', props: { kind: 'hbar', rows: { $expr: grouped }, x: 'label', y: 'value', sort: '-value', limit: 12, format: 'number', emptyText: 'Nothing to group' }, rules: { visible: needsGroup } },
          ], 3), slot: 'step:check' },
        ],
      }],
    }],
    buttons: [button('Add tile', 'open-builder', { disabled: 'form.saving' }, 'outline', 'plus')],
    actions: {
      'open-builder': { steps: [
        { 'set-state': { key: 'draft', value: draft } },
        { 'set-state': { key: 'step', value: 'source' } },
        { 'set-state': { key: 'builder', value: true } },
      ] },
    },
    panels: [], locked: 'false',
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
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
    ...extras.panels,
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `spreadsheet-bi-${kind}`, displayName: `BI ${entity.singular.toLowerCase()}`,
      description: `View and edit a Spreadsheet BI ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, ...(extras.state ? { state: extras.state } : {}), tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'spreadsheet-bi-settings', displayName: 'Spreadsheet BI settings', description: 'Edit the Spreadsheet BI settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [dashboardsAccess('Choose the default dashboard for new snapshots'), schemaAccess],
      data: dashboardSources,
      tree: [
        pageHeader(
          [heading('Spreadsheet BI settings'), text('The default dashboard for new snapshots. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('dashboards', `The ${containers.dashboards.path} folder could not be read. Reinstall Spreadsheet BI to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const countOf = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`

const containerNotices = () => Object.keys(containers).map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Spreadsheet BI to recreate it.`)[0])

function homePage() {
  const dashboardRows = `{{ (data.dashboards || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', tiles: (e.data.tiles || []).length, description: e.data.description || '' })).sort((a, b) => (a.code < b.code ? -1 : 1)) }}`
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'spreadsheet-bi-home', name: 'Spreadsheet BI', description: 'Saved BI dashboards over your workspace record files.', icon: 'layout-dashboard' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          dashboardsAccess('List the saved dashboards'),
          { path: containers.snapshots.path, reason: 'Count the snapshots' },
        ],
        data: {
          dashboards: folder(containers.dashboards.path, mimeTypes.dashboard),
          snapshots: folder(containers.snapshots.path, mimeTypes.snapshot),
        },
        tree: page([
          pageHeader(
            [heading('Spreadsheet BI'), text('Dashboards are saved tile definitions computed live from sibling apps\' record files. Edit spreadsheets themselves with the Office integration; this app only computes and freezes values.', 'muted')], [
            row([
              button('Viewer', [openFile(`${installRoot}/canvas/viewer.page.yaml`)], undefined, 'outline', 'monitor'),
              button('Snapshots', [openFile(`${installRoot}/canvas/snapshots.page.yaml`)], undefined, 'outline', 'camera'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Dashboards', countOf('dashboards'), 'layout-dashboard', loading('dashboards')),
            stat('Snapshots', countOf('snapshots'), 'camera', loading('snapshots')),
            stat('Taken', countOf('snapshots', "e.data.status === 'taken'"), 'check', loading('snapshots')),
            stat('Drafts', countOf('snapshots', "e.data.status !== 'taken'"), 'pencil', loading('snapshots')),
          ]),
          ...containerNotices(),
          card('Dashboards', [
            row([button(`Open ${containers.dashboards.path}`, [openFile(containers.dashboards.path)], undefined, 'outline', 'folder-open')]),
            table(dashboardRows, [['code', 'Code'], ['name', 'Name'], ['tiles', 'Tiles', 'end'], ['description', 'Description']],
              `No dashboards yet. Use New in ${containers.dashboards.path}.`, true),
          ]),
        ]),
      },
    },
  }
}

function viewerPage() {
  const selected = `(((data.dashboards || []).filter(e => ${active} && e.path === state.dashboard)[0] || {}).data || null)`
  return {
    file: 'viewer.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'spreadsheet-bi-viewer', name: 'Dashboard viewer', description: 'A saved dashboard computed live from its source containers.', icon: 'monitor' },
      spec: {
        access: [
          dashboardsAccess('Read the dashboard tile definitions'),
          ...sourceContainers.map(path => ({ path, reason: `Compute tile values over ${path} (when the owning app is installed)` })),
        ],
        data: {
          dashboards: folder(containers.dashboards.path, mimeTypes.dashboard),
          ...Object.fromEntries(sourceContainers.map(path => [sourceKey(path), { kind: 'folder', path, contents: true }])),
          dashboardoptions: { kind: 'computed', expr: options('dashboards', "e.data.name || ''") },
          selected: { kind: 'computed', expr: selected },
          tilerows: { kind: 'computed', expr: tileRows(`((${selected} || {}).tiles || [])`) },
          drillrows: { kind: 'computed', expr: `(state.drill ? [((((${selected} || {}).tiles) || []).find(t => (t.title || '') === state.drill.title) || null)] : []).filter(t => !!t)`
            + `.reduce((all, t) => all.concat((${sourcesMap}[t.source] || []).filter(x => x.kind === 'file' && x.data && x.data.state !== 'archived')`
            + `.filter(x => !t.filter || !t.filter.field || String(${get('x.data', 't.filter.field')}) === String(t.filter.equals === undefined || t.filter.equals === null ? '' : t.filter.equals))`
            + `.filter(x => !state.drill.detail || ${groupKey(get('x.data', 't.groupByField'))} === state.drill.detail)`
            + `.map(x => ({ path: x.path, code: x.data.code || x.name, label: x.data.name || x.data.title || x.data.subject || x.data.description || '', value: t.valueField ? ${get('x.data', 't.valueField')} : '' }))), [])` },
        },
        state: { dashboard: '', drill: null },
        tree: page([
          pageHeader(
            [heading('Dashboard viewer'), text('Tile values are computed live from the source containers each time this page loads. Take a snapshot to freeze them.', 'muted')], [
            row([
              button('Dashboards', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'layout-dashboard'),
              button('Snapshots', [openFile(`${installRoot}/canvas/snapshots.page.yaml`)], undefined, 'outline', 'camera'),
            ]),
          ]),
          ...status('dashboards', `The ${containers.dashboards.path} folder could not be read. Reinstall Spreadsheet BI to recreate it.`),
          grid([
            { type: 'canvas.form.select', props: { label: 'Dashboard', value: '{{ state.dashboard }}', options: '{{ data.dashboardoptions }}' } },
          ]),
          { ...text('Choose a dashboard to compute its tiles.', 'muted'), rules: { visible: '!state.dashboard' } },
          { ...text('{{ (data.selected && data.selected.name) || \'\' }} — {{ (data.selected && data.selected.description) || \'\' }}', 'muted'), rules: { visible: '!!data.selected' } },
          { ...table('{{ data.tilerows }}', tileColumns, 'This dashboard has no tiles yet. Add tiles in its form.'), rules: { visible: '!!state.dashboard' },
            props: { ...table('{{ data.tilerows }}', tileColumns, '').props, clickable: true, emptyText: 'This dashboard has no tiles yet. Add tiles in its form.' },
            on: { 'row-click': [{ 'set-state': { key: 'drill', value: { $expr: '({ title: event.title, detail: event.detail })' } } }] } },
          // Drill-down: the records behind the chosen tile row (its source, its filter, and the group the row is).
          { ...card("{{ 'Records behind ' + state.drill.title + (state.drill.detail ? ' · ' + state.drill.detail : '') }}", [
            table('{{ data.drillrows }}', [['code', 'Record'], ['label', 'Name'], ['value', 'Value', 'end']], 'No records behind this tile row.', true),
            button('Close', [{ 'set-state': { key: 'drill', value: null } }], undefined, 'ghost'),
          ]), rules: { visible: '!!state.dashboard && !!state.drill' } },
          text('Sums are computed from decimal-string amounts; non-numeric values and unavailable containers are skipped with a note. Spreadsheet editing itself is provided by the platform\'s Office integration.', 'muted'),
        ]),
      },
    },
  }
}

function snapshotsPage() {
  const rows = `{{ (data.snapshots || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, dashboard: ((((data.dashboards || []).find(d => d.kind === 'file' && d.data && d.path === e.data.dashboard) || {}).data || {}).name) || (e.data.dashboard || ''), status: e.data.status || '', takenAt: e.data.takenAt || '', results: (e.data.results || []).length })).sort((a, b) => (a.code < b.code ? -1 : 1)) }}`
  return {
    file: 'snapshots.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'spreadsheet-bi-snapshots', name: 'Snapshots', description: 'Frozen dashboard computations.', icon: 'camera' },
      spec: {
        access: [
          { path: containers.snapshots.path, reason: 'List the snapshots' },
          dashboardsAccess('Show each snapshot\'s dashboard name'),
        ],
        data: {
          snapshots: folder(containers.snapshots.path, mimeTypes.snapshot),
          dashboards: folder(containers.dashboards.path, mimeTypes.dashboard),
        },
        tree: page([
          pageHeader(
            [heading('Snapshots'), text('Each snapshot freezes one dashboard computation: the take-snapshot script computes every tile with exact decimal math, stamps the time and locks the record.', 'muted')], [
            row([
              button('Dashboards', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'layout-dashboard'),
              button(`Open ${containers.snapshots.path}`, [openFile(containers.snapshots.path)], undefined, 'outline', 'folder-open'),
            ]),
          ]),
          ...containerNotices(),
          stats([
            stat('Snapshots', countOf('snapshots'), 'camera', loading('snapshots')),
            stat('Taken', countOf('snapshots', "e.data.status === 'taken'"), 'check', loading('snapshots')),
            stat('Drafts', countOf('snapshots', "e.data.status !== 'taken'"), 'pencil', loading('snapshots')),
          ], 3),
          table(rows, [['code', 'Code'], ['dashboard', 'Dashboard'], ['status', 'Status'], ['takenAt', 'Taken at'], ['results', 'Results', 'end']],
            `No snapshots yet. Use New in ${containers.snapshots.path}.`, true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), viewerPage(), snapshotsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
