import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, starterRecords, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
const unboundPages = ['home.page.yaml', 'tickets.page.yaml', 'sla.page.yaml', 'workload.page.yaml']

describe('Helpdesk Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('helpdesk.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/helpdesk/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/helpdesk/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the ticket action script from the ticket form', () => {
    const document = documents['ticket.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['resolve', 'close'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Closed tickets lock their form: saving is disabled once the stage is closed.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.stage === 'closed'")
  })

  it('offers CRM customers on tickets without requiring CRM', () => {
    const document = documents['ticket.form.yaml']
    expect(document.spec.data.companies).toMatchObject({ kind: 'folder', path: '/customers' })
    const patch = document.spec.actions['copy-customer'].steps[0]['patch-form'].values.customerName
    expect(patch).toContain('form.values.customerRef')
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/crm', version: 'latest', optional: true })
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

describe('Helpdesk manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('helpdesk.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine, and optionally CRM', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
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
      const to = `${starter.kind === 'team' ? containers.teams.path : containers.tickets.path}/${starter.code}`
      expect(spec.install.find(entry => entry.to === to)).toMatchObject({
        from: `seed/starter/${starter.code}.json`, mode: 'seed', mime: mimeTypes[starter.kind],
      })
    }
    expect(spec.install.find(entry => entry.to === '/settings/helpdesk.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Helpdesk report pages', () => {
  const ticket = (code, stage, deadline, assignee = '') => ({ kind: 'file', path: `/tickets/${code}`, data: {
    code, state: 'active', subject: `Subject ${code}`, team: '/helpdesk-teams/TEAM-0001', priority: 'normal',
    stage, slaDeadline: deadline, assignee,
  } })
  const data = {
    teams: [{ kind: 'file', path: '/helpdesk-teams/TEAM-0001', data: { state: 'active', name: 'Care', members: ['A', 'B'], slaHours: 24 } }],
    tickets: [
      ticket('TKT-1', 'new', '2020-01-01T00:00:00Z'),
      ticket('TKT-2', 'in-progress', '2999-01-01T00:00:00Z', 'Avery'),
      ticket('TKT-3', 'solved', '2020-01-01T00:00:00Z', 'Avery'),
      ticket('TKT-4', 'closed', '2020-01-01T00:00:00Z'),
    ],
  }
  data.rows = evaluate(documents['sla.page.yaml'].spec.data.rows.expr, data)

  it('flags only open tickets past their deadline as overdue', () => {
    expect(data.rows.map(row => [row.code, row.overdue])).toEqual([
      ['TKT-1', true], ['TKT-2', false], ['TKT-3', false], ['TKT-4', false],
    ])
    expect(data.rows[0].team).toBe('Care')
  })

  it('lists open tickets by deadline in the SLA report', () => {
    const tableNode = documents['sla.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.table')
    expect(template(tableNode.props.rows, data).map(row => [row.code, row.state])).toEqual([
      ['TKT-1', 'Overdue'], ['TKT-2', 'On track'],
    ])
    expect(tableNode.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit' } }])
  })

  it('sums open and overdue tickets per team and assignee in the workload summary', () => {
    const tables = JSON.stringify(documents['workload.page.yaml'].spec.tree)
    const cards = documents['workload.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [teamsTable] = cards[0].children
    const [assigneesTable] = cards[1].children
    expect(template(teamsTable.props.rows, data)).toEqual([
      { path: '/helpdesk-teams/TEAM-0001', team: 'Care', members: 2, slaHours: 24, open: 2, overdue: 1, solved: 1 },
    ])
    expect(template(assigneesTable.props.rows, data)).toEqual([
      { assignee: 'Avery', open: 1, overdue: 0 },
      { assignee: 'Unassigned', open: 1, overdue: 1 },
    ])
    expect(tables).toContain('Unassigned')
  })

  it('groups tickets by stage on the tickets page', () => {
    const page = documents['tickets.page.yaml']
    const panels = page.spec.tree[0].children.find(node => node.type === 'canvas.tabs').children
    expect(panels.map(panel => panel.slot)).toEqual(['new', 'in-progress', 'waiting', 'solved', 'closed'])
    const waiting = panels.find(panel => panel.slot === 'in-progress').children[0]
    expect(template(waiting.props.rows, data).map(row => row.code)).toEqual(['TKT-2'])
  })
})
