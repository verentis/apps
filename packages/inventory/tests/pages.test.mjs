import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, lowStockWidgetFile, manifest, postScriptFileAccess,
  postScriptName, postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, recordPath, schemas, starterRecords, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])

describe('Inventory Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('inventory.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents] },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/inventory/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/inventory/canvas/${kind}.form.yaml`)}`)
    expect(spec.capabilities).toEqual([])
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it.each([['move', ['post-move']], ['adjustment', ['apply-adjustment']]])(
    'runs the posting script against %s files', (kind, operations) => {
      const document = documents[`${kind}.form.yaml`]
      const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
      expect(runs.map(run => run.parameters.operation)).toEqual(operations)
      for (const run of runs) {
        expect(run.file).toBe(postScriptPath)
        expect(run.parameters.path).toBe('{{ ctx.file.path }}')
      }
      expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
      // A script reloads the record afterwards, which a dirty form would refuse.
      const tree = JSON.stringify(document.spec.tree)
      expect(tree).toMatch(/form\.saving \|\| form\.dirty/)
    })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'stock.page.yaml', lowStockWidgetFile]) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Inventory manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('inventory.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([{ package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' }])
    expect(spec.scripts).toEqual(['scripts/create', 'scripts/post'])
    expect(spec.permissions).toContain('execution.run')
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
      expect(creatable.mime).toBe(mimeTypes[creatable.id])
      const path = creatable.template.slice(2)
      expect(files.some(pattern => pattern.test(path)), path).toBe(true)
      expect(existsSync(new URL(path, root)), path).toBe(true)
    }
  })

  it('seeds the containers, starter records and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    for (const starter of starterRecords) {
      const directive = spec.install.find(entry => entry.to === recordPath(starter))
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[starter.kind] })
      expect(read(directive.from)).toEqual(plain(starter))
      // Seeds install in order: the container exists before its records.
      expect(spec.install.indexOf(directive)).toBeGreaterThan(spec.install.findIndex(entry => entry.to === containers[`${starter.kind}s`].path))
    }
    expect(spec.install.find(entry => entry.to === '/settings/inventory.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

const product = (code, name, sku, reorderPoint) =>
  ({ kind: 'file', path: `/products/${code}`, data: { kind: 'product', code, name, sku, unit: 'ea', reorderPoint } })
const warehouse = (code, name) => ({ kind: 'file', path: `/warehouses/${code}`, data: { kind: 'warehouse', code, name } })
const move = (code, status, productCode, quantity, from, to) => ({
  kind: 'file', path: `/stock-moves/${code}`,
  data: { kind: 'move', code, status, product: `/products/${productCode}`, quantity,
    fromWarehouse: from ? `/warehouses/${from}` : '', fromLocation: '', toWarehouse: to ? `/warehouses/${to}` : '', toLocation: '' },
})
const sample = {
  products: [product('PRD-1', 'Desk', 'DESK', '5'), product('PRD-2', 'Chair', 'CHAIR', '')],
  warehouses: [warehouse('WH-1', 'Main'), warehouse('WH-2', 'Annex')],
  moves: [
    move('MOV-1', 'done', 'PRD-1', '20.5', '', 'WH-1'),
    move('MOV-2', 'done', 'PRD-1', '16', 'WH-1', ''),
    move('MOV-3', 'done', 'PRD-1', '2', 'WH-1', 'WH-2'),
    move('MOV-4', 'done', 'PRD-2', '3', '', 'WH-2'),
    move('MOV-5', 'draft', 'PRD-2', '999', '', 'WH-1'),
  ],
}

describe('Inventory stock report', () => {
  const stock = documents['stock.page.yaml']

  it('computes on hand from done moves only and flags the reorder point', () => {
    const data = { ...sample }
    data.totals = evaluate(stock.spec.data.totals.expr, data)
    data.levels = evaluate(stock.spec.data.levels.expr, data)
    expect(data.totals).toEqual([
      expect.objectContaining({ code: 'PRD-1', units: 45000, hasReorder: true }),
      expect.objectContaining({ code: 'PRD-2', units: 30000, hasReorder: false }),
    ])
    const tables = JSON.stringify(stock.spec.tree).match(/"rows":"(\{\{ .*? \}\})"/g).map(match => JSON.parse(`{${match}}`).rows)
    expect(template(tables[0], data)).toEqual([
      expect.objectContaining({ code: 'PRD-1', onHand: 4.5, reorderPoint: '5', state: 'Reorder' }),
      expect.objectContaining({ code: 'PRD-2', onHand: 3, reorderPoint: '', state: '' }),
    ])
    expect(template(tables[1], data)).toEqual([
      { path: '/products/PRD-1', code: 'PRD-1', product: 'Desk', warehouse: 'Main', onHand: 2.5 },
      { path: '/products/PRD-1', code: 'PRD-1', product: 'Desk', warehouse: 'Annex', onHand: 2 },
      { path: '/products/PRD-2', code: 'PRD-2', product: 'Chair', warehouse: 'Annex', onHand: 3 },
    ])
  })

  it('offers the Low stock widget as a packaged, installed Canvas page', () => {
    expect(manifest.spec.widgets).toEqual([expect.objectContaining({ id: 'low-stock', 'display-name': 'Low stock', 'default-size': { w: 4, h: 4 } })])
    const [{ route }] = manifest.spec.widgets
    expect(route.startsWith('/render?')).toBe(true)
    const document = new URLSearchParams(route.slice(route.indexOf('?'))).get('document')
    expect(document).toBe(`./canvas/${lowStockWidgetFile}`)
    expect(existsSync(new URL(document, root))).toBe(true)
    expect(manifest.spec.install.find(directive => globToRegExp(directive.from).test(document.slice(2))))
      .toMatchObject({ to: '/applications/inventory/canvas/', mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' })
    const widget = documents[lowStockWidgetFile]
    const low = evaluate(widget.spec.data.low.expr, sample)
    expect(low).toEqual([expect.objectContaining({ code: 'PRD-1', units: 45000 })])
  })
})
