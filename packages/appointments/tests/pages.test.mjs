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
const unboundPages = ['home.page.yaml', 'upcoming.page.yaml', 'types.page.yaml']

describe('Appointments Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('appointments.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/appointments/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/appointments/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the appointment action script from the appointment form', () => {
    const document = documents['appointment.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['confirm', 'complete', 'cancel', 'mark-no-show'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Finished appointments lock their form.
    expect(JSON.stringify(document.spec.tree)).toContain("['done', 'cancelled', 'no-show'].includes(form.values.status)")
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

describe('Appointments manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('appointments.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine only', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
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

  it('lets the action script read the types for the schedule and conflict check', () => {
    expect(postScriptFileAccess).toContainEqual(expect.objectContaining({ path: containers.types.path, mode: 'read' }))
    expect(postScriptFileAccess).toContainEqual(expect.objectContaining({ path: containers.appointments.path, mode: 'write' }))
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
    expect(spec.install.find(entry => entry.to === '/settings/appointments.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Appointments report pages', () => {
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const booking = (code, date, start, end, status, host = 'Robin') => ({ kind: 'file', path: `/appointments/${code}`, data: {
    code, state: 'active', guestName: `Guest ${code}`, type: '/appointment-types/APT-0001', host,
    date, startTime: start, endTime: end, status,
  } })
  const data = {
    types: [{ kind: 'file', path: '/appointment-types/APT-0001', data: {
      code: 'APT-0001', state: 'active', name: 'Intro call', durationMinutes: 30, bufferMinutes: 10, host: 'Robin', active: true,
    } }],
    appointments: [
      booking('APMT-1', day(0), '14:00', '14:30', 'booked'),
      booking('APMT-2', day(0), '09:00', '09:30', 'confirmed'),
      booking('APMT-3', day(2), '10:00', '10:30', 'booked'),
      booking('APMT-4', day(-1), '10:00', '10:30', 'done'),
      booking('APMT-5', day(1), '11:00', '11:30', 'cancelled'),
    ],
  }
  data.rows = evaluate(documents['upcoming.page.yaml'].spec.data.rows.expr, data)

  it('resolves type names on the appointment rows', () => {
    expect(data.rows[0]).toMatchObject({ code: 'APMT-1', type: 'Intro call', host: 'Robin', time: '14:00–14:30' })
  })

  it('lists today and upcoming in schedule order, excluding past and finished appointments', () => {
    const cards = documents['upcoming.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [today] = cards[0].children
    const [upcoming] = cards[1].children
    expect(template(today.props.rows, data).map(row => row.code)).toEqual(['APMT-2', 'APMT-1'])
    expect(template(upcoming.props.rows, data).map(row => row.code)).toEqual(['APMT-2', 'APMT-1', 'APMT-3'])
  })

  it('summarises bookings per type on the types page', () => {
    const [byType] = documents['types.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')[0].children
    expect(template(byType.props.rows, data)).toEqual([{
      path: '/appointment-types/APT-0001', code: 'APT-0001', name: 'Intro call', minutes: 30, buffer: 10,
      host: 'Robin', active: 'Yes', appointments: 5, upcoming: 3, done: 1,
    }])
  })
})
