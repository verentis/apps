import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { stagePanels } from '../../../tools/file-apps/test-helpers.mjs'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containerOf, containers, mimeTypes, recordKinds, schemas, starterRecords, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
const unboundPages = ['home.page.yaml', 'requests.page.yaml', 'allocations.page.yaml']

describe('Time Off Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('time-off.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents] },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
    for (const starter of starterRecords) expect(JSON.parse(text(`seed/starter/${starter.code}.json`))).toEqual(plain(starter))
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/time-off/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/time-off/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the request action script from the request form', () => {
    const document = documents['request.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['submit', 'approve', 'refuse'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Submitted, approved and refused requests lock their form: only drafts stay editable.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.status === 'draft'")
  })

  it('renders requiresApproval as a switch on the leave type form', () => {
    const tree = JSON.stringify(documents['type.form.yaml'].spec.tree)
    expect(tree).toContain('canvas.form.switch')
    expect(tree).toContain('form.values.requiresApproval')
  })

  it('offers Employees records on requests without requiring Employees', () => {
    const document = documents['request.form.yaml']
    expect(document.spec.data.staff).toMatchObject({ kind: 'folder', path: '/employees' })
    const patch = document.spec.actions['copy-employee'].steps[0]['patch-form'].values.employeeName
    expect(patch).toContain('form.values.employeeRef')
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/employees', version: 'latest', optional: true })
  })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of unboundPages) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Time Off manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('time-off.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine, and optionally Employees', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/employees', version: 'latest', optional: true },
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

  it('seeds the containers, starter records and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    for (const starter of starterRecords) {
      const to = `${containers[containerOf[starter.kind]].path}/${starter.code}`
      expect(spec.install.find(entry => entry.to === to)).toMatchObject({
        from: `seed/starter/${starter.code}.json`, mode: 'seed', mime: mimeTypes[starter.kind],
      })
    }
    expect(spec.install.find(entry => entry.to === '/settings/time-off.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Time Off report pages', () => {
  const type = (code, name, daysPerYear, requiresApproval = true) => ({ kind: 'file', path: `/leave-types/${code}`, data: {
    code, state: 'active', name, daysPerYear, requiresApproval,
  } })
  const request = (code, employee, typeCode, days, status, approver = '') => ({ kind: 'file', path: `/leave-requests/${code}`, data: {
    code, state: 'active', employeeName: employee, type: `/leave-types/${typeCode}`,
    startDate: '2026-03-02', endDate: '2026-03-06', days, status, approver,
  } })
  const data = {
    types: [type('LT-0001', 'Annual leave', '15'), type('LT-0002', 'Sick leave', '10', false)],
    requests: [
      request('TO-1', 'Avery', 'LT-0001', '5', 'approved', 'Jordan'),
      request('TO-2', 'Avery', 'LT-0001', '2.5', 'approved', 'Jordan'),
      request('TO-3', 'Avery', 'LT-0002', '1', 'approved', 'Jordan'),
      request('TO-4', 'Blake', 'LT-0001', '4', 'submitted'),
      request('TO-5', 'Blake', 'LT-0001', '3', 'draft'),
    ],
  }
  data.rows = evaluate(documents['requests.page.yaml'].spec.data.rows.expr, data)
  data.summary = evaluate(documents['allocations.page.yaml'].spec.data.summary.expr, data)

  it('flattens requests with their leave type names and days in ten-thousandths', () => {
    expect(data.rows.map(row => [row.code, row.type, row.days, row.status])).toEqual([
      ['TO-1', 'Annual leave', 50000, 'approved'], ['TO-2', 'Annual leave', 25000, 'approved'],
      ['TO-3', 'Sick leave', 10000, 'approved'], ['TO-4', 'Annual leave', 40000, 'submitted'],
      ['TO-5', 'Annual leave', 30000, 'draft'],
    ])
  })

  it('groups requests by status on the requests page', () => {
    const panels = stagePanels(documents['requests.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.tabs'))
    expect(panels.map(panel => panel.slot)).toEqual(['draft', 'submitted', 'approved', 'refused'])
    const submitted = panels.find(panel => panel.slot === 'submitted').children[0]
    expect(template(submitted.props.rows, data).map(row => [row.code, row.daysText])).toEqual([['TO-4', '4.00']])
    expect(submitted.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }])
  })

  it('sums approved days against each type\'s allocation per employee', () => {
    expect(data.summary).toEqual([
      { employee: 'Avery', typePath: '/leave-types/LT-0001', type: 'Annual leave', allocated: 150000, taken: 75000 },
      { employee: 'Avery', typePath: '/leave-types/LT-0002', type: 'Sick leave', allocated: 100000, taken: 10000 },
    ])
    const card = documents['allocations.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.card')
    expect(template(card.children[0].props.rows, data)).toEqual([
      { employee: 'Avery', type: 'Annual leave', allocated: '15.00', taken: '7.50', remaining: '7.50' },
      { employee: 'Avery', type: 'Sick leave', allocated: '10.00', taken: '1.00', remaining: '9.00' },
    ])
  })
})
