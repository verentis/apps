import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  balancesWidgetFile, createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, starterAccounts, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])

describe('Accounting Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('accounting.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents] },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it('use workspace files instead of the business store', () => {
    for (const [name, document] of Object.entries(documents)) {
      expect(JSON.stringify(document), name).not.toMatch(/business-command|financial-operation|"business"/)
    }
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/accounting/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/accounting/canvas/${kind}.form.yaml`)}`)
    expect(spec.capabilities).toEqual([])
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it.each([['journal', ['post-journal', 'reverse-journal']], ['expense', ['post-expense', 'reverse-expense']]])(
    'posts and reverses %s files through the posting script', (kind, operations) => {
      const document = documents[`${kind}.form.yaml`]
      const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
      expect(runs.map(run => run.parameters.operation)).toEqual(operations)
      for (const run of runs) {
        expect(run.file).toBe(postScriptPath)
        expect(run.parameters.path).toBe('{{ ctx.file.path }}')
      }
      expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
      // A script reloads the record afterwards, which a dirty form would refuse.
      const post = JSON.stringify(document.spec.tree)
      expect(post).toContain('"click":"post"')
      expect(post).toMatch(/form\.saving \|\| form\.dirty/)
    })

  it.each(Object.keys(containers))('leaves the %s container to the file browser and offers its records in New', name => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes[name])).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes[name])).map(creatable => creatable.mime)
    expect(offered).toEqual(containers[name].holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'reports.page.yaml', balancesWidgetFile]) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })
})

describe('Accounting manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('accounting.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine', () => {
    expect(manifest.metadata.version).toBe('0.2.0')
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

  it('seeds the containers, starter chart and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    for (const account of starterAccounts) {
      const directive = spec.install.find(entry => entry.to === `/chart-of-accounts/${account.code}`)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes.account })
      expect(read(directive.from)).toEqual(account)
      // Seeds install in order: the container exists before its records.
      expect(spec.install.indexOf(directive)).toBeGreaterThan(spec.install.findIndex(entry => entry.to === containers.accounts.path))
    }
    expect(spec.install.find(entry => entry.to === '/settings/accounting.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Accounting workspace desktop', () => {
  const widget = documents[balancesWidgetFile]

  it('offers the Balances widget as a packaged, installed Canvas page', () => {
    expect(manifest.spec.widgets).toEqual([expect.objectContaining({ id: 'balances', 'display-name': 'Balances', 'default-size': { w: 4, h: 4 } })])
    const [{ route }] = manifest.spec.widgets
    expect(route.startsWith('/render?')).toBe(true)
    const document = new URLSearchParams(route.slice(route.indexOf('?'))).get('document')
    expect(document).toBe(`./canvas/${balancesWidgetFile}`)
    expect(existsSync(new URL(document, root))).toBe(true)
    expect(manifest.packaging.files.map(globToRegExp).some(pattern => pattern.test(document.slice(2)))).toBe(true)
    expect(manifest.spec.install.find(directive => globToRegExp(directive.from).test(document.slice(2))))
      .toMatchObject({ to: '/applications/accounting/canvas/', mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' })
  })

  it('shows balance-sheet balances from posted journals only', () => {
    const account = (code, number, name, accountType) =>
      ({ kind: 'file', path: `/chart-of-accounts/${code}`, data: { kind: 'account', code, number, name, accountType } })
    const line = (code, direction, amount) => ({ account: `/chart-of-accounts/${code}`, direction, amount })
    const data = {
      accounts: [account('ACC-1', '1000', 'Bank', 'asset'), account('ACC-2', '2000', 'Payables', 'liability'),
        account('ACC-3', '4000', 'Sales', 'income'), account('ACC-4', '3000', 'Capital', 'equity'), account('ACC-5', '1100', 'Petty cash', 'asset')],
      journals: [
        { kind: 'file', path: '/journals/JNL-1', data: { status: 'posted', lines: [line('ACC-1', 'debit', '100.10'), line('ACC-3', 'credit', '80.10'), line('ACC-2', 'credit', '20.00')] } },
        { kind: 'file', path: '/journals/JNL-2', data: { status: 'draft', lines: [line('ACC-5', 'debit', '999.00'), line('ACC-4', 'credit', '999.00')] } },
      ],
    }
    data.balances = evaluate(widget.spec.data.balances.expr, data)
    const [header, ...body] = widget.spec.tree[0].children
    const table = body.find(node => node.type === 'canvas.table')
    expect(template(header.children[0].children[1].props.text, data)).toBe('Assets 100.10 · Liabilities 20.00')
    expect(template(table.props.rows, data)).toEqual([
      { path: '/chart-of-accounts/ACC-1', account: '1000 Bank', type: 'asset', balance: '100.10' },
      { path: '/chart-of-accounts/ACC-2', account: '2000 Payables', type: 'liability', balance: '20.00' },
    ])
  })
})
