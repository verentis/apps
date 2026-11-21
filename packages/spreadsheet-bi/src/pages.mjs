// Generates the Spreadsheet BI Canvas documents: a bound form per record kind, the settings form, the dashboards
// list (launch page), the live dashboard viewer and the snapshots list. Tile values are computed live by Canvas
// expressions over the source containers; freezing them is done by the take-snapshot script the snapshot form runs.
// Spreadsheet *editing* belongs to the platform's Office integration — these pages only view computed values.
import {
  archived, badge, baseActions, boundForm, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, text, toneExpression,
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
  + `.map(c => ({ c: c, numeric: c.items.filter(i => (typeof i.raw === 'number' || typeof i.raw === 'string') && i.raw !== '' && isFinite(Number(i.raw))), keys: c.items.map(i => i.key).filter((v, idx, a) => a.indexOf(v) === idx).sort() }))`
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
  if (kind === 'dashboard') {
    return {
      access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, panels: [], locked: 'false',
    }
  }
  const resultRows = `(form.values.results || []).reduce((all, r) => all.concat(r.groups && r.groups.length`
    + ` ? r.groups.map(g => ({ title: r.title || '', detail: g.key || '', value: g.value === undefined ? '' : g.value, note: r.note || '' }))`
    + ` : [{ title: r.title || '', detail: '', value: r.value === undefined ? '' : r.value, note: r.note || '' }]), [])`
  return {
    access: [dashboardsAccess('Choose the dashboard a snapshot computes'), schemaAccess],
    data: dashboardSources,
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
    ])],
    locked: taken,
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
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
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
    ...extras.panels,
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `spreadsheet-bi-${kind}`, displayName: `BI ${entity.singular.toLowerCase()}`,
      description: `View and edit a Spreadsheet BI ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'spreadsheet-bi-settings', displayName: 'Spreadsheet BI settings', description: 'Edit the Spreadsheet BI settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [dashboardsAccess('Choose the default dashboard for new snapshots'), schemaAccess],
      data: dashboardSources,
      tree: [
        row([
          column([heading('Spreadsheet BI settings'), text('The default dashboard for new snapshots. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
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
          row([
            column([heading('Spreadsheet BI'), text('Dashboards are saved tile definitions computed live from sibling apps\' record files. Edit spreadsheets themselves with the Office integration; this app only computes and freezes values.', 'muted')]),
            row([
              button('Viewer', [openFile(`${installRoot}/canvas/viewer.page.yaml`)], undefined, 'outline', 'monitor'),
              button('Snapshots', [openFile(`${installRoot}/canvas/snapshots.page.yaml`)], undefined, 'outline', 'camera'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
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
        },
        state: { dashboard: '' },
        tree: page([
          row([
            column([heading('Dashboard viewer'), text('Tile values are computed live from the source containers each time this page loads. Take a snapshot to freeze them.', 'muted')]),
            row([
              button('Dashboards', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'layout-dashboard'),
              button('Snapshots', [openFile(`${installRoot}/canvas/snapshots.page.yaml`)], undefined, 'outline', 'camera'),
            ]),
          ], 'between'),
          ...status('dashboards', `The ${containers.dashboards.path} folder could not be read. Reinstall Spreadsheet BI to recreate it.`),
          grid([
            { type: 'canvas.form.select', props: { label: 'Dashboard', value: '{{ state.dashboard }}', options: '{{ data.dashboardoptions }}' } },
          ]),
          { ...text('Choose a dashboard to compute its tiles.', 'muted'), rules: { visible: '!state.dashboard' } },
          { ...text('{{ (data.selected && data.selected.name) || \'\' }} — {{ (data.selected && data.selected.description) || \'\' }}', 'muted'), rules: { visible: '!!data.selected' } },
          { ...table('{{ data.tilerows }}', tileColumns, 'This dashboard has no tiles yet. Add tiles in its form.'), rules: { visible: '!!state.dashboard' } },
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
          row([
            column([heading('Snapshots'), text('Each snapshot freezes one dashboard computation: the take-snapshot script computes every tile with exact decimal math, stamps the time and locks the record.', 'muted')]),
            row([
              button('Dashboards', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'layout-dashboard'),
              button(`Open ${containers.snapshots.path}`, [openFile(containers.snapshots.path)], undefined, 'outline', 'folder-open'),
            ]),
          ], 'between'),
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
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
