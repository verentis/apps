import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { stagePanels } from '../../../tools/file-apps/test-helpers.mjs'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
const unboundPages = ['home.page.yaml', 'week.page.yaml', 'shifts.page.yaml']

describe('Planning Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('planning.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/planning/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/planning/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the shift action script from the shift form', () => {
    const document = documents['shift.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['publish', 'confirm'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Confirmed shifts lock their form.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.status === 'confirmed'")
  })

  it('offers Employees records on shifts without requiring Employees', () => {
    const document = documents['shift.form.yaml']
    expect(document.spec.data.people).toMatchObject({ kind: 'folder', path: '/employees' })
    const patch = document.spec.actions['copy-employee'].steps[0]['patch-form'].values.employee
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

describe('Planning manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('planning.app.yaml').spec['file-access']

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

  it('seeds the containers and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    expect(spec.install.find(entry => entry.to === '/settings/planning.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Planning report pages', () => {
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const shift = (code, employee, date, start, end, status) => ({ kind: 'file', path: `/shifts/${code}`, data: {
    code, state: 'active', employee, role: '/shift-roles/PLR-0001', date, startTime: start, endTime: end, status,
  } })
  const data = {
    roles: [{ kind: 'file', path: '/shift-roles/PLR-0001', data: { state: 'active', name: 'Barista' } }],
    shifts: [
      shift('SHF-1', 'Avery', day(0), '08:00', '16:00', 'published'),
      shift('SHF-2', 'Jordan', day(0), '12:00', '20:00', 'draft'),
      shift('SHF-3', 'Avery', day(2), '08:00', '16:00', 'confirmed'),
      shift('SHF-4', 'Avery', day(30), '08:00', '16:00', 'published'),
      shift('SHF-5', 'Jordan', day(-2), '08:00', '16:00', 'confirmed'),
    ],
  }
  data.rows = evaluate(documents['week.page.yaml'].spec.data.rows.expr, data)

  it('resolves role names on the shift rows', () => {
    expect(data.rows[0]).toMatchObject({ code: 'SHF-1', role: 'Barista', time: '08:00–16:00' })
  })

  it('groups the coming week by date and employee, excluding past and far-future shifts', () => {
    const cards = documents['week.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [byDate] = cards[0].children
    const [byEmployee] = cards[1].children
    const [weekList] = cards[2].children
    expect(template(byDate.props.rows, data)).toEqual([
      { date: day(0), shifts: 2, employees: 2, confirmed: 0 },
      { date: day(2), shifts: 1, employees: 1, confirmed: 1 },
    ])
    expect(template(byEmployee.props.rows, data)).toEqual([
      { employee: 'Avery', shifts: 2, published: 2 },
      { employee: 'Jordan', shifts: 1, published: 0 },
    ])
    expect(template(weekList.props.rows, data).map(row => row.code)).toEqual(['SHF-1', 'SHF-2', 'SHF-3'])
  })

  it('groups shifts by status on the shifts page', () => {
    const page = documents['shifts.page.yaml']
    const panels = stagePanels(page.spec.tree[0].children.find(node => node.type === 'canvas.tabs'))
    expect(panels.map(panel => panel.slot)).toEqual(['draft', 'published', 'confirmed'])
    const published = panels.find(panel => panel.slot === 'published').children[0]
    expect(template(published.props.rows, data).map(row => row.code)).toEqual(['SHF-1', 'SHF-4'])
  })
})
