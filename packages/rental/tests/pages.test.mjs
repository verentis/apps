import { handOvers } from '../scripts/post/main.mjs'
import { apiContract } from '../../../tools/file-apps/build.mjs'
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

describe('Rental Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', async () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('rental.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents], api: await apiContract(new URL('../', import.meta.url)) },
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
    expect(bind['json-schema'].source).toBe(`/applications/rental/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/rental/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the booking script from the booking form', () => {
    const document = documents['booking.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect([...new Set(runs.map(run => run.parameters.operation))]).toEqual(['confirm-booking', 'pickup-booking', 'return-booking', 'cancel-booking'])
    // Returning asks Invoicing (through the platform) to draft the invoice; Rental never writes /invoices.
    expect(Object.values(documents).some(page => JSON.stringify(page).includes('call-app'))).toBe(false)
    expect(handOvers['return-booking']).toMatchObject({ app: 'invoicing', operation: 'create-draft-invoice', recordOperation: 'record-invoice' })
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(runs.find(run => run.parameters.operation === 'return-booking' && run.parameters.date).parameters.date).toBe('{{ state.returndate }}')
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // The script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
  })

  it('copies a CRM customer name into the booking', () => {
    const document = documents['booking.form.yaml']
    expect(document.spec.data.companies).toMatchObject({ kind: 'folder', path: '/customers' })
    const patch = document.spec.actions['copy-name'].steps[0]['patch-form'].values.customerName
    expect(patch).toContain('form.values.customerRef')
  })

  it('locks confirmed, picked-up and returned bookings but leaves products editable', () => {
    const save = form => documents[form].spec.tree[0].children.find(node => node.type !== 'canvas.validation-summary').children.at(-1).children.find(node => node.props?.label === 'Save')
    expect(save('booking.form.yaml').rules.disabled).toContain("['confirmed', 'picked-up', 'returned'].includes(form.values.status)")
    expect(save('product.form.yaml').rules.disabled).not.toContain('status')
  })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'bookings.page.yaml', 'availability.page.yaml', 'revenue.page.yaml']) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Rental manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('rental.app.yaml').spec['file-access']

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
    expect(spec.install.find(entry => entry.to === '/settings/rental.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date('2026-03-10T12:00:00Z') : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)

describe('Rental availability summary', () => {
  it('subtracts overlapping confirmed and picked-up bookings covering today from what is owned', () => {
    const widget = documents['availability.page.yaml']
    const product = (code, owned, status = 'available') => ({ kind: 'file', path: `/rental-products/${code}`, data: {
      code, name: `Product ${code}`, state: 'active', status, dailyRate: '100.00', quantityOwned: owned,
    } })
    const booking = (product, status, startDate, endDate, quantity) => ({ kind: 'file', path: '/rental-bookings/x', data: {
      state: 'active', product, status, startDate, endDate, quantity,
    } })
    const data = {
      products: [product('RPRD-0001', 5), product('RPRD-0002', 2, 'unavailable')],
      bookings: [
        booking('/rental-products/RPRD-0001', 'confirmed', '2026-03-01', '2026-03-31', 2),
        booking('/rental-products/RPRD-0001', 'picked-up', '2026-03-10', '2026-03-10', 1),
        booking('/rental-products/RPRD-0001', 'confirmed', '2026-04-01', '2026-04-05', 5), // not covering today
        booking('/rental-products/RPRD-0001', 'returned', '2026-03-01', '2026-03-31', 5),  // holds nothing
        booking('/rental-products/RPRD-0002', 'confirmed', '2026-03-01', '2026-03-31', 1),
      ],
    }
    const rows = evaluate(widget.spec.data.availability.expr, data)
    expect(rows).toEqual([
      expect.objectContaining({ code: 'RPRD-0001', owned: 5, out: 3, available: 2 }),
      expect.objectContaining({ code: 'RPRD-0002', owned: 2, out: 1, available: 0 }),
    ])
  })
})
