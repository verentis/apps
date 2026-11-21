import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, seedDashboardPath, settingsPath, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])

describe('Spreadsheet BI Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('spreadsheet-bi.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents] },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it('never builds a spreadsheet editor: no grid, formula or sheet-editing surfaces', () => {
    for (const [name, document] of Object.entries(documents)) {
      expect(JSON.stringify(document), name).not.toMatch(/spreadsheet-editor|formula|workbook|office\./)
    }
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/spreadsheet-bi/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/spreadsheet-bi/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the take-snapshot script from the snapshot form and locks taken snapshots', () => {
    const document = documents['snapshot.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['take-snapshot'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    expect(JSON.stringify(document.spec.tree)).toMatch(/status === 'taken'/)
  })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'viewer.page.yaml', 'snapshots.page.yaml']) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Spreadsheet BI manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('spreadsheet-bi.app.yaml').spec['file-access']

  it('requires only Canvas and nodejs; every business app is optional', () => {
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
      { package: 'verentis/invoicing', version: 'latest', optional: true },
      { package: 'verentis/accounting', version: 'latest', optional: true },
      { package: 'verentis/helpdesk', version: 'latest', optional: true },
    ])
    expect(spec.scripts).toEqual(['scripts/create', 'scripts/post'])
  })

  it('asks install consent for every document\'s file access', () => {
    expect(consent.length).toBeLessThanOrEqual(64)
    for (const [file, document] of Object.entries(documents)) {
      const id = document.spec.binds?.length ? document.metadata.id : `canvas/${file}`
      for (const grant of document.spec.access ?? []) {
        expect(consent, `${file} ${grant.path}`).toContainEqual(expect.objectContaining({ path: grant.path, origin: { kind: 'document', id } }))
      }
    }
  })

  it.each([['create', createScriptName, createScriptFileAccess], ['post', postScriptName, postScriptFileAccess]])(
    'asks install consent for the %s script\'s file access', (directory, name, access) => {
      const scriptManifest = readFileSync(new URL(`scripts/${directory}/manifest.yaml`, root), 'utf8')
      expect(scriptManifest).toContain(`id: ${name}`)
      for (const grant of access) {
        expect(scriptManifest).toContain(`path: ${JSON.stringify(grant.path)}`)
        expect(consent).toContainEqual({ ...grant, origin: { kind: 'script', id: name } })
      }
    })

  it('declares valid creatables named by the create script', () => {
    expect(spec.creatables.map(creatable => creatable.id)).toEqual(recordKinds)
    for (const creatable of spec.creatables) {
      expect(creatable.script).toBe('./scripts/create')
      const path = creatable.template.slice(2)
      expect(files.some(pattern => pattern.test(path)), path).toBe(true)
      expect(existsSync(new URL(path, root)), path).toBe(true)
    }
  })

  it('seeds the containers, settings and the sample dashboard once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    expect(spec.install.find(entry => entry.to === settingsPath)).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    const starter = spec.install.find(entry => entry.to === seedDashboardPath)
    expect(starter).toMatchObject({ from: 'seed/starter/BID-0001.json', mode: 'seed', mime: mimeTypes.dashboard })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp. The viewer's computed
// sources also read the page state (the selected dashboard).
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data, state) => new Function('data', 'state', 'Date', `return (${expression})`)(data, state, canvasDate)
const template = (value, data, state) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data, state)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data, state))

describe('Dashboard viewer live expressions', () => {
  const spec = () => documents['viewer.page.yaml'].spec
  const entry = (path, data) => ({ kind: 'file', path, name: path.split('/').pop(), data })
  const customer = (code, type, state = 'active') => entry(`/customers/${code}`, { code, name: code, kind: 'company', state, type })
  const invoice = (code, status, gross) => entry(`/invoices/${code}`, { code, kind: 'invoice', state: 'active', status, totals: { gross } })

  const dashboard = tiles => entry(seedDashboardPath, { code: 'BID-0001', kind: 'dashboard', state: 'active', name: 'Sales overview', description: 'Live sales KPIs', tiles })
  const compute = (tiles, sources) => {
    const state = { dashboard: seedDashboardPath }
    const data = { journals: [], expenses: [], ...sources, dashboards: [dashboard(tiles)] }
    data.dashboardoptions = evaluate(spec().data.dashboardoptions.expr, data, state)
    data.selected = evaluate(spec().data.selected.expr, data, state)
    data.tilerows = evaluate(spec().data.tilerows.expr, data, state)
    return { data, state, rows: data.tilerows }
  }

  it('offers dashboards and resolves the selected one', () => {
    const { data } = compute([], { customers: [], invoices: [] })
    expect(data.dashboardoptions).toEqual([{ value: seedDashboardPath, label: 'BID-0001 · Sales overview' }])
    expect(data.selected).toMatchObject({ name: 'Sales overview' })
  })

  it('computes the seeded tiles live: group-count of customers by type and the issued-invoice sum', () => {
    const tiles = [
      { sequence: '2', title: 'Issued revenue', source: '/invoices', kind: 'sum', valueField: 'totals.gross', groupByField: '', filter: { field: 'status', equals: 'issued' } },
      { sequence: '1', title: 'Customers by type', source: '/customers', kind: 'group-count', valueField: '', groupByField: 'type' },
    ]
    const { rows } = compute(tiles, {
      customers: [customer('CUST-1', 'customer'), customer('CUST-2', 'customer'), customer('CUST-3', 'prospect'),
        customer('CUST-4', 'customer', 'archived'), customer('CUST-5', undefined)],
      invoices: [invoice('INV-1', 'issued', '100.50'), invoice('INV-2', 'issued', '49.50'),
        invoice('INV-3', 'draft', '10.00'), invoice('INV-4', 'issued', 'oops')],
    })
    expect(rows).toEqual([
      { title: 'Customers by type', kind: 'group-count', detail: '(none)', value: '1', note: '' },
      { title: 'Customers by type', kind: 'group-count', detail: 'customer', value: '2', note: '' },
      { title: 'Customers by type', kind: 'group-count', detail: 'prospect', value: '1', note: '' },
      { title: 'Issued revenue', kind: 'sum', detail: '', value: '150.00', note: '1 non-numeric value(s) skipped' },
    ])
  })

  it('counts and group-sums with exact two-decimal display', () => {
    const tiles = [
      { sequence: '1', title: 'Open invoices', source: '/invoices', kind: 'count', valueField: '', groupByField: '', filter: { field: 'status', equals: 'issued' } },
      { sequence: '2', title: 'Revenue by status', source: '/invoices', kind: 'group-sum', valueField: 'totals.gross', groupByField: 'status' },
    ]
    const { rows } = compute(tiles, { customers: [], invoices: [invoice('INV-1', 'issued', '0.10'), invoice('INV-2', 'issued', '0.20'), invoice('INV-3', 'draft', '7')] })
    expect(rows).toEqual([
      { title: 'Open invoices', kind: 'count', detail: '', value: '2', note: '' },
      { title: 'Revenue by status', kind: 'group-sum', detail: 'draft', value: '7.00', note: '' },
      { title: 'Revenue by status', kind: 'group-sum', detail: 'issued', value: '0.30', note: '' },
    ])
  })

  it('skips unavailable containers, unknown sources, unknown kinds and empty groups with a note', () => {
    const tiles = [
      { sequence: '1', title: 'Tickets', source: '/tickets', kind: 'count', valueField: '', groupByField: '' },
      { sequence: '2', title: 'Quotes', source: '/quotations', kind: 'count', valueField: '', groupByField: '' },
      { sequence: '3', title: 'Median', source: '/invoices', kind: 'median', valueField: '', groupByField: '' },
      { sequence: '4', title: 'By status', source: '/invoices', kind: 'group-count', valueField: '', groupByField: 'status' },
    ]
    const { rows } = compute(tiles, { customers: [], invoices: [], tickets: undefined })
    expect(rows).toEqual([
      { title: 'Tickets', kind: 'count', detail: '', value: '', note: 'Container /tickets is unavailable; tile skipped. Is its app installed?' },
      { title: 'Quotes', kind: 'count', detail: '', value: '', note: 'Source /quotations is not readable from this viewer; tile skipped.' },
      { title: 'Median', kind: 'median', detail: '', value: '', note: 'Unknown tile kind "median"; tile skipped.' },
      { title: 'By status', kind: 'group-count', detail: '', value: '0', note: 'No matching records.' },
    ])
  })

  it('renders the tile table from the computed rows', () => {
    const { data, state } = compute([], { customers: [], invoices: [] })
    expect(JSON.stringify(spec().tree)).toContain('{{ data.tilerows }}')
    expect(template('{{ data.tilerows }}', data, state)).toEqual(data.tilerows ?? [])
  })
})
