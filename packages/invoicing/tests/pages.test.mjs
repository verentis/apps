import { handOvers } from '../scripts/post/main.mjs'
import { apiContract } from '../../../tools/file-apps/build.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, desktopFolder, dueWidgetFile, featureOverlay, manifest, postScriptFileAccess,
  postScriptName, postScriptPath, productionOverlay, scriptConsents,
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

describe('Invoicing Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', async () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('invoicing.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents], api: await apiContract(new URL('../', import.meta.url)) },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it('use workspace files instead of the business store or email delivery', () => {
    for (const [name, document] of Object.entries(documents)) {
      expect(JSON.stringify(document), name).not.toMatch(/business-command|financial-operation|"business"|delivery|email-settings/)
    }
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/invoicing/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/invoicing/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it.each([['invoice', ['issue-invoice']], ['credit', ['issue-credit']], ['payment', ['post-payment', 'reverse-payment']]])(
    'runs the posting script from %s forms', (kind, operations) => {
      const document = documents[`${kind}.form.yaml`]
      const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
      expect(runs.map(run => run.parameters.operation)).toEqual(operations)
      for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
      // The script has Accounting post the journal itself (a server-side app call); no page calls an app.
      expect(steps(document).some(step => 'call-app' in step)).toBe(false)
      for (const operation of operations) expect(handOvers[operation]).toMatchObject({ app: 'accounting', required: true })
      expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
      // A script reloads the record afterwards, which a dirty form would refuse.
      expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    })

  it('copies a CRM customer into the invoice as a snapshot', () => {
    const document = documents['invoice.form.yaml']
    expect(document.spec.data.companies).toMatchObject({ kind: 'folder', path: '/customers' })
    const patch = document.spec.actions['copy-customer'].steps[0]['patch-form'].values.customer
    expect(patch).toContain('form.values.customerRef')
  })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'receivables.page.yaml', dueWidgetFile]) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Invoicing manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('invoicing.app.yaml').spec['file-access']

  it('depends on the latest Canvas, nodejs engine and Accounting, and optionally CRM', () => {
    expect(manifest.metadata.version).toBe('0.2.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/accounting', version: 'latest' }, { package: 'verentis/crm', version: 'latest', optional: true },
    ])
    expect(spec.scripts).toEqual(['scripts/create', 'scripts/post', 'scripts/api'])
    // Other apps draft invoices through Invoicing's API, never by writing /invoices.
    expect(read('invoicing.app.yaml').spec.api.operations.map(operation => operation.key)).toEqual(['create-draft-invoice'])
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
    expect(spec.install.find(entry => entry.to === '/settings/invoicing.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Invoicing workspace desktop', () => {
  const files = manifest.packaging.files.map(globToRegExp)

  it('offers the Invoices due widget as a packaged, installed Canvas page', () => {
    expect(manifest.spec.widgets).toEqual([expect.objectContaining({ id: 'invoices-due', 'display-name': 'Invoices due', 'default-size': { w: 4, h: 4 } })])
    const [{ route }] = manifest.spec.widgets
    expect(route.startsWith('/render?')).toBe(true)
    const document = new URLSearchParams(route.slice(route.indexOf('?'))).get('document')
    expect(document).toBe(`./canvas/${dueWidgetFile}`)
    expect(existsSync(new URL(document, root))).toBe(true)
    expect(files.some(pattern => pattern.test(document.slice(2)))).toBe(true)
    expect(manifest.spec.install.find(directive => globToRegExp(directive.from).test(document.slice(2))))
      .toMatchObject({ to: '/applications/invoicing/canvas/', mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' })
  })

  it('lists open invoices by due date with what is still outstanding', () => {
    const widget = documents[dueWidgetFile]
    const invoice = (code, status, dueDate, gross) => ({ kind: 'file', path: `/invoices/${code}`, data: {
      code, status, state: 'active', dueDate, currency: 'ZAR', customer: { name: `Customer ${code}` }, ...(status === 'issued' ? { totals: { gross } } : {}),
    } })
    const data = {
      invoices: [invoice('INV-2', 'issued', '2999-01-01', '50.00'), invoice('INV-1', 'issued', '2020-01-01', '100.00'),
        invoice('INV-3', 'draft', '2020-01-01', '9.00'), invoice('INV-4', 'issued', '2020-01-01', '5.00')],
      credits: [{ kind: 'file', path: '/credit-notes/CN-1', data: { status: 'issued', invoice: '/invoices/INV-1', totals: { gross: '10.00' } } }],
      payments: [{ kind: 'file', path: '/payments/PAY-1', data: { status: 'posted', allocations: [
        { invoice: '/invoices/INV-1', amount: '20.00' }, { invoice: '/invoices/INV-4', amount: '5.00' }] } }],
    }
    data.receivables = evaluate(widget.spec.data.receivables.expr, data)
    const [header, ...body] = widget.spec.tree[0].children
    const table = body.find(node => node.type === 'canvas.table')
    expect(template(header.children[0].children[1].props.text, data)).toBe('2 open · 1 overdue')
    expect(template(table.props.rows, data)).toEqual([
      { path: '/invoices/INV-1', code: 'INV-1', customer: 'Customer INV-1', amount: 'ZAR 70.00', due: '2020-01-01 · overdue' },
      { path: '/invoices/INV-2', code: 'INV-2', customer: 'Customer INV-2', amount: 'ZAR 50.00', due: '2999-01-01' },
    ])
    expect(table.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }])
  })

  it('installs a valid Invoice follow-up window layout into its app desktop folder', () => {
    const layout = read('desktop/invoice-follow-up.layout.yaml')
    expect(layout).toMatchObject({ 'api-version': 'verentis.io/v1', kind: 'WindowLayout', metadata: { id: 'invoice-follow-up', name: 'Invoice follow-up' } })
    const { windows, zones, focus } = layout.spec
    expect(windows).toEqual([
      { id: 'customers', app: 'crm', 'entry-point': 'home' },
      { id: 'receivables', app: 'invoicing', 'entry-point': 'receivables' },
    ])
    expect(manifest.spec['entry-points'].map(entryPoint => entryPoint.id)).toContain('receivables')
    expect(read('../crm/crm.app.yaml').spec['entry-points'].map(entryPoint => entryPoint.id)).toContain('home')
    expect(zones).toEqual([{ width: 400, tabs: ['customers'], active: 'customers' }, { width: 'flex', tabs: ['receivables'], active: 'receivables' }])
    expect(zones.flatMap(zone => zone.tabs).sort()).toEqual(windows.map(window => window.id).sort())
    expect(windows.map(window => window.id)).toContain(focus)
    expect(manifest.spec.install).toContainEqual({ from: 'desktop/*.layout.yaml', to: desktopFolder, mode: 'managed' })
    expect(desktopFolder).toBe('/.workspace/desktop/apps/invoicing/')
    expect(files.some(pattern => pattern.test('desktop/invoice-follow-up.layout.yaml'))).toBe(true)
  })
})
