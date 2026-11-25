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
const unboundPages = ['home.page.yaml', 'events.page.yaml', 'registrations.page.yaml']

describe('Events Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('events.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/events/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/events/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the action script from the event and registration forms', () => {
    const eventRuns = steps(documents['event.form.yaml']).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(eventRuns.map(run => run.parameters.operation)).toEqual(['publish', 'complete', 'cancel'])
    const registrationRuns = steps(documents['registration.form.yaml']).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(registrationRuns.map(run => run.parameters.operation)).toEqual(['confirm', 'check-in', 'cancel-registration'])
    for (const run of [...eventRuns, ...registrationRuns]) {
      expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    }
    for (const file of ['event.form.yaml', 'registration.form.yaml']) {
      expect(documents[file].spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
      // A script reloads the record afterwards, which a dirty form would refuse.
      expect(JSON.stringify(documents[file].spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    }
    // Done/cancelled events and attended/cancelled registrations lock their forms.
    const locked = expression => JSON.stringify(expression).slice(1, -1)
    expect(JSON.stringify(documents['event.form.yaml'].spec.tree)).toContain(locked('["done","cancelled"].includes(form.values.status)'))
    expect(JSON.stringify(documents['registration.form.yaml'].spec.tree)).toContain(locked('["attended","cancelled"].includes(form.values.status)'))
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

describe('Events manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('events.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine', () => {
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
    expect(spec.install.find(entry => entry.to === '/settings/events.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Events report pages', () => {
  const event = (code, status, capacity) => ({ kind: 'file', path: `/events/${code}`, data: {
    code, state: 'active', name: `Event ${code}`, venue: 'Hall', startsAt: '2026-06-10T09:00:00Z', status, capacity,
  } })
  const registration = (code, eventPath, qty, status, state = 'active') => ({ kind: 'file', path: `/event-registrations/${code}`, data: {
    code, state, attendeeName: `Attendee ${code}`, event: eventPath, qty, status,
  } })
  const data = {
    events: [event('EVT-1', 'published', 10), event('EVT-2', 'draft', 5)],
    registrations: [
      registration('EVR-1', '/events/EVT-1', 4, 'confirmed'),
      registration('EVR-2', '/events/EVT-1', 3, 'attended'),
      registration('EVR-3', '/events/EVT-1', 2, 'draft'),
      registration('EVR-4', '/events/EVT-1', 2, 'cancelled'),
      registration('EVR-5', '/events/EVT-1', 9, 'confirmed', 'archived'),
      registration('EVR-6', '/events/EVT-2', 1, 'confirmed'),
    ],
  }
  const spec = documents['registrations.page.yaml'].spec
  data.rows = evaluate(spec.data.rows.expr, data)
  data.registrationrows = evaluate(spec.data.registrationrows.expr, data)

  it('sums only confirmed and attended seats against capacity', () => {
    expect(data.rows.map(row => [row.code, row.taken, row.capacity, row.remaining])).toEqual([
      ['EVT-1', 7, 10, 3], ['EVT-2', 1, 5, 4],
    ])
  })

  it('summarises capacity and attendance per event on the registrations page', () => {
    const cards = spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [summaryTable] = cards[0].children
    expect(template(summaryTable.props.rows, data)).toEqual([
      { path: '/events/EVT-1', code: 'EVT-1', name: 'Event EVT-1', status: 'published', capacity: 10, taken: 7, remaining: 3, fill: '70%' },
      { path: '/events/EVT-2', code: 'EVT-2', name: 'Event EVT-2', status: 'draft', capacity: 5, taken: 1, remaining: 4, fill: '20%' },
    ])
    expect(summaryTable.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }])
    const [registrationTable] = cards[1].children
    expect(template(registrationTable.props.rows, data).map(row => [row.code, row.event, row.status])).toEqual([
      ['EVR-1', 'Event EVT-1', 'confirmed'], ['EVR-2', 'Event EVT-1', 'attended'], ['EVR-3', 'Event EVT-1', 'draft'],
      ['EVR-4', 'Event EVT-1', 'cancelled'], ['EVR-6', 'Event EVT-2', 'confirmed'],
    ])
  })

  it('groups events by status on the events page', () => {
    const page = documents['events.page.yaml']
    const panels = stagePanels(page.spec.tree[0].children.find(node => node.type === 'canvas.tabs'))
    expect(panels.map(panel => panel.slot)).toEqual(['draft', 'published', 'ongoing', 'done', 'cancelled'])
    const published = panels.find(panel => panel.slot === 'published').children[0]
    expect(template(published.props.rows, data).map(row => row.code)).toEqual(['EVT-1'])
  })

  it('shows the seats taken against capacity on the event form', () => {
    const tree = JSON.stringify(documents['event.form.yaml'].spec.tree)
    expect(tree).toContain('Seats taken')
    expect(documents['event.form.yaml'].spec.data.registrations).toMatchObject({ kind: 'folder', path: '/event-registrations' })
  })
})
