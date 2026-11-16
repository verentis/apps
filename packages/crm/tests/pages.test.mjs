import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptConsent, createScriptFileAccess, createScriptName, featureOverlay, followUpsWidgetFile, manifest, productionOverlay,
} from '../src/app.mjs'
import { allKinds, childFolders, childKinds, containers, mimeTypes, recordKinds, schemas, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)

function steps(document) {
  return Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
}

describe('CRM Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('crm.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...createScriptConsent] },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it('use workspace files instead of the business store', () => {
    for (const [name, document] of Object.entries(documents)) {
      const text = JSON.stringify(document)
      expect(text, name).not.toMatch(/business-command|recover-business-command|crm\.integration/)
      expect(Object.values(document.spec.data ?? {}).map(source => source.kind), name).not.toContain('business')
    }
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/crm/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/crm/canvas/${kind}.form.yaml`)}`)
    expect(spec['mime-types'].map(type => type.pattern)).toEqual([mimeTypes[kind]])
    expect(spec.permissions).toEqual(expect.arrayContaining(['file.read', 'file.write']))
    expect(spec.capabilities).toEqual([])
    expect(spec['file-access'].length).toBeGreaterThan(0)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    expect(steps(bind.document).some(step => 'reset-form' in step)).toBe(true)
  })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered.sort()).toEqual(containers[name].holds.map(kind => mimeTypes[kind]).sort())
  })

  it('home page links to the seeded containers', () => {
    const text = JSON.stringify(documents['home.page.yaml'])
    expect(text).toContain('/customers')
    expect(text).toContain('/deals')
  })
})

describe('CRM manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)

  it('is file oriented', () => {
    expect(spec.permissions).toEqual(['file.read', 'file.write', 'execution.run'])
    expect(manifest.metadata.version).toBe('0.2.11')
    expect(manifest.marketplace.keywords).toEqual(expect.arrayContaining(['crm', 'customers', 'contacts', 'deals', 'cases']))
  })

  it('asks install consent for every document\'s file access, attributed to the document', () => {
    const consent = read('crm.app.yaml').spec['file-access']
    expect(consent.length).toBeLessThanOrEqual(64)
    for (const [file, document] of Object.entries(documents)) {
      const id = document.spec.binds?.length ? document.metadata.id : `canvas/${file}`
      for (const grant of document.spec.access ?? []) {
        expect(consent, `${file} ${grant.path}`).toContainEqual(expect.objectContaining({
          path: grant.path, mode: grant.mode ?? 'read', origin: { kind: 'document', id },
        }))
      }
    }
    expect(consent).toContainEqual(expect.objectContaining({ origin: { kind: 'document', id: 'canvas/home.page.yaml' } }))
  })

  it('asks install consent for the create script\'s file access, attributed to the script', () => {
    const consent = read('crm.app.yaml').spec['file-access']
    const scriptManifest = readFileSync(new URL('scripts/create/manifest.yaml', root), 'utf8')
    expect(scriptManifest).toContain(`id: ${createScriptName}`)
    for (const grant of createScriptFileAccess) {
      expect(scriptManifest).toContain(`path: ${JSON.stringify(grant.path)}`)
      expect(consent).toContainEqual({ ...grant, origin: { kind: 'script', id: createScriptName } })
    }
  })

  it('declares valid creatables', () => {
    const ids = spec.creatables.map(creatable => creatable.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual([...allKinds].sort())
    for (const creatable of spec.creatables) {
      expect(creatable.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
      expect(creatable['entry-point'], creatable.id).toBeUndefined()
      expect(creatable.script, creatable.id).toBe('./scripts/create')
      expect(creatable.template, creatable.id).toBeDefined()
      expect(creatable.mime).toBe(mimeTypes[creatable.id])
      if (creatable.template) {
        expect(creatable.template).toMatch(/^\.\//)
        const path = creatable.template.slice(2)
        expect(files.some(pattern => pattern.test(path)), path).toBe(true)
        expect(existsSync(new URL(path, root)), path).toBe(true)
      }
      for (const parent of creatable.parents ?? []) expect(Object.values(mimeTypes)).toContain(parent)
    }
    for (const kind of recordKinds) expect(spec.creatables.find(c => c.id === kind).parents).toHaveLength(1)
    for (const kind of childKinds) {
      const creatable = spec.creatables.find(c => c.id === kind)
      expect(creatable.parents).toEqual(recordKinds.map(record => mimeTypes[record]))
      expect(creatable['folder-names']).toEqual([childFolders[kind]])
    }
  })

  it('ships the create script with its generated config', () => {
    expect(existsSync(new URL('scripts/create/manifest.yaml', root))).toBe(true)
    expect(existsSync(new URL('scripts/create/config.mjs', root))).toBe(true)
    expect(files.some(pattern => pattern.test('scripts/create/propose.mjs'))).toBe(true)
    expect(spec.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ package: 'verentis/nodejs' })]))
  })

  it('grants record forms read access to related containers and keeps child forms confined', () => {
    for (const kind of recordKinds) {
      const access = documents[`${kind}.form.yaml`].spec.access
      expect(access.length, kind).toBeGreaterThan(0)
      for (const grant of access) expect(grant.mode ?? 'read').toBe('read')
    }
    for (const kind of childKinds) expect(documents[`${kind}.form.yaml`].spec.access, kind).toBeUndefined()
  })

  it('declares every folder the unbound home page lists', () => {
    const { spec } = documents['home.page.yaml']
    const granted = spec.access.map(grant => grant.path)
    expect(granted).toEqual(Object.values(containers).map(container => container.path))
    for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, source.path).toContain(source.path)
  })

  it('seeds the containers and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    expect(spec.install.find(entry => entry.to === '/settings/crm.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('CRM workspace desktop', () => {
  const widget = documents[followUpsWidgetFile]

  it('offers the Follow-ups widget as a packaged, installed Canvas page', () => {
    expect(manifest.spec.widgets).toEqual([expect.objectContaining({ id: 'follow-ups', 'display-name': 'Follow-ups', 'default-size': { w: 4, h: 5 } })])
    const [{ route }] = manifest.spec.widgets
    expect(route.startsWith('/render?')).toBe(true)
    const document = new URLSearchParams(route.slice(route.indexOf('?'))).get('document')
    expect(document).toBe(`./canvas/${followUpsWidgetFile}`)
    expect(existsSync(new URL(document, root))).toBe(true)
    expect(manifest.packaging.files.map(globToRegExp).some(pattern => pattern.test(document.slice(2)))).toBe(true)
    expect(manifest.spec.install.find(directive => globToRegExp(directive.from).test(document.slice(2))))
      .toMatchObject({ to: '/applications/crm/canvas/', mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' })
    const granted = widget.spec.access.map(grant => grant.path)
    for (const source of Object.values(widget.spec.data).filter(source => source.kind === 'folder')) expect(granted).toContain(source.path)
  })

  it('lists overdue deals and urgent cases first, then deals closing soon and other open cases', () => {
    const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
    const record = (path, data) => ({ kind: 'file', path, data: { state: 'active', ...data } })
    const data = {
      cases: [
        record('/cases/CASE-1', { code: 'CASE-1', subject: 'Invoice question', status: 'open', priority: 'low', createdAt: '2026-01-01T00:00:00Z' }),
        record('/cases/CASE-2', { code: 'CASE-2', subject: 'Outage', status: 'new', priority: 'urgent', createdAt: '2026-01-02T00:00:00Z' }),
        record('/cases/CASE-3', { code: 'CASE-3', subject: 'Resolved', status: 'resolved', priority: 'urgent' }),
        record('/cases/CASE-4', { code: 'CASE-4', subject: 'Archived', status: 'open', priority: 'urgent', state: 'archived' }),
      ],
      deals: [
        record('/deals/DEAL-1', { code: 'DEAL-1', title: 'Renewal', outcome: 'open', expectedCloseDate: day(-2) }),
        record('/deals/DEAL-2', { code: 'DEAL-2', title: 'Upsell', outcome: 'open', expectedCloseDate: day(3) }),
        record('/deals/DEAL-3', { code: 'DEAL-3', title: 'Next year', outcome: 'open', expectedCloseDate: day(60) }),
        record('/deals/DEAL-4', { code: 'DEAL-4', title: 'Won', outcome: 'won', expectedCloseDate: day(-2) }),
        record('/deals/DEAL-5', { code: 'DEAL-5', title: 'Undated', outcome: 'open', expectedCloseDate: '' }),
      ],
    }
    data.followups = evaluate(widget.spec.data.followups.expr, data)
    const [header, ...body] = widget.spec.tree[0].children
    const table = body.find(node => node.type === 'canvas.table')
    expect(template(header.children[0].children[1].props.text, data)).toBe('2 open cases · 2 deals closing')
    expect(template(table.props.rows, data)).toEqual([
      { path: '/deals/DEAL-1', code: 'DEAL-1', title: 'Renewal', due: `closes ${day(-2)} · overdue` },
      { path: '/cases/CASE-2', code: 'CASE-2', title: 'Outage', due: 'urgent priority' },
      { path: '/deals/DEAL-2', code: 'DEAL-2', title: 'Upsell', due: `closes ${day(3)}` },
      { path: '/cases/CASE-1', code: 'CASE-1', title: 'Invoice question', due: 'low priority' },
    ])
    expect(table.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit' } }])
  })
})
