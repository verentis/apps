import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess,
  postScriptName, postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containerOf, containers, mimeTypes, recordKinds, recordPath, schemas, starterRecords, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])

describe('Fleet Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('fleet.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/fleet/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/fleet/canvas/${kind}.form.yaml`)}`)
    expect(spec.capabilities).toEqual([])
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it.each([['service', ['log-service']], ['vehicle', ['retire']]])(
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

  it('declares every folder and file the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'contracts.page.yaml', 'costs.page.yaml']) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'file')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Fleet manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('fleet.app.yaml').spec['file-access']

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
      expect(spec.install.indexOf(directive)).toBeGreaterThan(spec.install.findIndex(entry => entry.to === containers[containerOf[starter.kind]].path))
    }
    expect(spec.install.find(entry => entry.to === '/settings/fleet.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

const daysFromNow = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const vehicle = (code, make, model, plate, status = 'active') =>
  ({ kind: 'file', path: `/vehicles/${code}`, data: { kind: 'vehicle', code, make, model, licensePlate: plate, status } })
const contract = (code, vehicleCode, status, endDate, monthlyCost, type = 'lease') => ({
  kind: 'file', path: `/fleet-contracts/${code}`,
  data: { kind: 'contract', code, vehicle: vehicleCode ? `/vehicles/${vehicleCode}` : '', type, vendor: 'Vendor',
    startDate: '2026-01-01', endDate, monthlyCost, status },
})
const service = (code, vehicleCode, status, cost) => ({
  kind: 'file', path: `/service-logs/${code}`,
  data: { kind: 'service', code, vehicle: `/vehicles/${vehicleCode}`, date: '2026-02-01', odometerKm: '100', type: 'repair', cost, status },
})
const sample = {
  vehicles: [vehicle('VEH-1', 'Toyota', 'Corolla', 'CA 1'), vehicle('VEH-2', 'Ford', 'Transit', 'CA 2')],
  contracts: [
    contract('FCON-1', 'VEH-1', 'active', daysFromNow(10), '650.00'),
    contract('FCON-2', 'VEH-1', 'active', daysFromNow(200), '120.50', 'insurance'),
    contract('FCON-3', 'VEH-2', 'expired', daysFromNow(-10), '900'),
    contract('FCON-4', 'VEH-2', 'active', daysFromNow(-5), '300'),
  ],
  services: [
    service('FSRV-1', 'VEH-1', 'done', '120.00'),
    service('FSRV-2', 'VEH-1', 'done', '85.50'),
    service('FSRV-3', 'VEH-1', 'draft', '999'),
    service('FSRV-4', 'VEH-2', 'done', '40'),
  ],
}

describe('Fleet reports', () => {
  it('flags active contracts ending within the configured window, overdue included', () => {
    const page = documents['contracts.page.yaml']
    const data = { ...sample, settings: { expiringSoonDays: 30 } }
    data.rows = evaluate(page.spec.data.rows.expr, data)
    data.expiring = evaluate(page.spec.data.expiring.expr, data)
    expect(data.expiring.map(c => c.code)).toEqual(['FCON-4', 'FCON-1'])
    // A wider window from the settings file pulls in later end dates; the default is 60 days.
    data.settings = { expiringSoonDays: 365 }
    expect(evaluate(page.spec.data.expiring.expr, data).map(c => c.code)).toEqual(['FCON-4', 'FCON-1', 'FCON-2'])
    data.settings = undefined
    expect(evaluate(page.spec.data.expiring.expr, data).map(c => c.code)).toEqual(['FCON-4', 'FCON-1'])
  })

  it('sums each vehicle\'s active contracts and done service costs exactly', () => {
    const page = documents['costs.page.yaml']
    const data = { ...sample }
    data.costs = evaluate(page.spec.data.costs.expr, data)
    expect(data.costs).toEqual([
      expect.objectContaining({ code: 'VEH-1', vehicle: 'Toyota Corolla', monthlyUnits: 7705000, serviceUnits: 2055000 }),
      expect.objectContaining({ code: 'VEH-2', vehicle: 'Ford Transit', monthlyUnits: 3000000, serviceUnits: 400000 }),
    ])
    const rows = JSON.stringify(page.spec.tree).match(/"rows":"(\{\{ .*? \}\})"/g).map(match => JSON.parse(`{${match}}`).rows)
    expect(template(rows[0], data)).toEqual([
      expect.objectContaining({ code: 'VEH-1', monthly: '770.50', service: '205.50' }),
      expect.objectContaining({ code: 'VEH-2', monthly: '300.00', service: '40.00' }),
    ])
  })
})
