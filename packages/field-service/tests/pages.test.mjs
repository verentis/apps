import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
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
const unboundPages = ['home.page.yaml', 'tasks.page.yaml', 'schedule.page.yaml']

describe('Field Service Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('field-service.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/field-service/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/field-service/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the task action script from the task form', () => {
    const document = documents['task.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['schedule', 'start', 'complete', 'cancel'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Done and cancelled tasks lock their form.
    expect(JSON.stringify(document.spec.tree)).toContain("['done', 'cancelled'].includes(form.values.stage)")
  })

  it('offers CRM customers on tasks without requiring CRM', () => {
    const document = documents['task.form.yaml']
    expect(document.spec.data.companies).toMatchObject({ kind: 'folder', path: '/customers' })
    const patch = document.spec.actions['copy-customer'].steps[0]['patch-form'].values.customerName
    expect(patch).toContain('form.values.customerRef')
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/crm', version: 'latest', optional: true })
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/invoicing', version: 'latest', optional: true })
  })

  it('leaves the tasks container to the file browser and offers tasks in New', () => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes.tasks)).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes.tasks)).map(creatable => creatable.mime)
    expect(offered).toEqual(containers.tasks.holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of unboundPages) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Field Service manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('field-service.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine, and optionally CRM and Invoicing', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
      { package: 'verentis/invoicing', version: 'latest', optional: true },
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

  it('may draft invoices: the post script asks to write /invoices', () => {
    expect(postScriptFileAccess).toContainEqual(expect.objectContaining({ path: '/invoices', mode: 'write' }))
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

  it('seeds the container and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    expect(spec.install.find(entry => entry.to === '/settings/field-service.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Field Service report pages', () => {
  const today = new Date().toISOString().slice(0, 10)
  const task = (code, stage, date, technician = '', windowStart = '') => ({ kind: 'file', path: `/field-tasks/${code}`, data: {
    code, state: 'active', customerName: `Customer ${code}`, address: '1 Main Rd', type: 'repair',
    stage, scheduledDate: date, technician, windowStart, windowEnd: windowStart ? '17:00' : '',
  } })
  const data = {
    tasks: [
      task('FST-1', 'scheduled', today, 'Sipho', '08:00'),
      task('FST-2', 'on-site', today, 'Sipho', '11:00'),
      task('FST-3', 'scheduled', today),
      task('FST-4', 'scheduled', '2020-01-01', 'Avery', '09:00'),
      task('FST-5', 'done', today, 'Sipho', '08:00'),
    ],
  }
  data.rows = evaluate(documents['schedule.page.yaml'].spec.data.rows.expr, data)

  it('flags only today\'s tasks', () => {
    expect(data.rows.map(row => [row.code, row.today])).toEqual([
      ['FST-1', true], ['FST-2', true], ['FST-3', true], ['FST-4', false], ['FST-5', true],
    ])
  })

  it('orders the day list by technician and window and sums per technician', () => {
    const cards = documents['schedule.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [techniciansTable] = cards[0].children
    const [dayTable] = cards[1].children
    expect(template(dayTable.props.rows, data).map(row => [row.technician, row.code])).toEqual([
      ['Sipho', 'FST-1'], ['Sipho', 'FST-2'], ['Unassigned', 'FST-3'],
    ])
    expect(template(techniciansTable.props.rows, data)).toEqual([
      { technician: 'Sipho', tasks: 2, onsite: 1 },
      { technician: 'Unassigned', tasks: 1, onsite: 0 },
    ])
    expect(dayTable.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit' } }])
  })

  it('groups tasks by stage on the tasks page', () => {
    const page = documents['tasks.page.yaml']
    const panels = page.spec.tree[0].children.find(node => node.type === 'canvas.tabs').children
    expect(panels.map(panel => panel.slot)).toEqual(['new', 'scheduled', 'on-site', 'done', 'cancelled'])
    const scheduled = panels.find(panel => panel.slot === 'scheduled').children[0]
    expect(template(scheduled.props.rows, data).map(row => row.code)).toEqual(['FST-1', 'FST-3', 'FST-4'])
  })
})
