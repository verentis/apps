import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { stagePanels } from '../../../tools/file-apps/test-helpers.mjs'
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
const unboundPages = ['home.page.yaml', 'inbox.page.yaml', 'workspaces.page.yaml', 'library.page.yaml']

describe('Documents Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('documents.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/documents/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/documents/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the workflow script from the document form', () => {
    const document = documents['document.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['send-to-review', 'validate', 'return-to-inbox', 'archive'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Validated and archived documents lock their form: saving is disabled in either status.
    expect(JSON.stringify(document.spec.tree)).toContain(JSON.stringify('["validated","archived-status"].includes(form.values.status)').slice(1, -1))
  })

  it('shows the VFS file path reference and a link to open the file', () => {
    const document = documents['document.form.yaml']
    const tree = JSON.stringify(document.spec.tree)
    expect(tree).toContain('{{ form.values.filePath }}')
    expect(tree).toContain('!!(form.values.filePath)')
    // The form never declares a data source over the referenced file: the card is metadata only.
    expect(Object.values(document.spec.data).filter(source => source.kind === 'file')).toEqual([])
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

describe('Documents manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('documents.app.yaml').spec['file-access']

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

  it('seeds the containers, starter records and settings once', () => {
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    for (const starter of starterRecords) {
      const container = { workspace: containers.workspaces, document: containers.cards, tag: containers.tags }[starter.kind]
      expect(spec.install.find(entry => entry.to === `${container.path}/${starter.code}`)).toMatchObject({
        from: `seed/starter/${starter.code}.json`, mode: 'seed', mime: mimeTypes[starter.kind],
      })
    }
    expect(spec.install.find(entry => entry.to === '/settings/documents.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Documents report pages', () => {
  const card = (code, status, tags, workspace = '/document-workspaces/DWS-0001', extra = {}) => ({
    kind: 'file', path: `/document-cards/${code}`, data: {
      code, state: 'active', title: `Title ${code}`, filePath: `/shared/${code}.pdf`,
      workspace, tags, owner: '', status, validatedAt: '', ...extra,
    },
  })
  const data = {
    workspaces: [
      { kind: 'file', path: '/document-workspaces/DWS-0001', data: { state: 'active', code: 'DWS-0001', name: 'Finance', defaultTags: ['finance'] } },
      { kind: 'file', path: '/document-workspaces/DWS-0002', data: { state: 'active', code: 'DWS-0002', name: 'Legal', defaultTags: ['legal'] } },
    ],
    cards: [
      card('DOC-1', 'inbox', ['finance', 'invoice']),
      card('DOC-2', 'in-review', ['legal'], '/document-workspaces/DWS-0002'),
      card('DOC-3', 'validated', ['finance'], '/document-workspaces/DWS-0001', { validatedAt: '2026-01-05T00:00:00Z' }),
      card('DOC-4', 'archived-status', [], '', { validatedAt: '2026-01-01T00:00:00Z' }),
    ],
  }
  data.rows = evaluate(documents['inbox.page.yaml'].spec.data.rows.expr, data)

  it('flattens cards with their workspace names and joined tags', () => {
    expect(data.rows.map(row => [row.code, row.workspace, row.tags])).toEqual([
      ['DOC-1', 'Finance', 'finance, invoice'], ['DOC-2', 'Legal', 'legal'], ['DOC-3', 'Finance', 'finance'], ['DOC-4', '', ''],
    ])
  })

  it('lists only inbox documents on the inbox page', () => {
    const tableNode = documents['inbox.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.table')
    expect(template(tableNode.props.rows, data).map(row => row.code)).toEqual(['DOC-1'])
    expect(tableNode.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }])
  })

  it('groups documents per workspace by tags in the workspace browser', () => {
    const cards = documents['workspaces.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [workspacesTable] = cards[0].children
    const [groupsTable] = cards[1].children
    const [groupedTable] = cards[2].children
    expect(template(workspacesTable.props.rows, data)).toEqual([
      { path: '/document-workspaces/DWS-0001', code: 'DWS-0001', name: 'Finance', defaultTags: 'finance', documents: 2, inbox: 1, inReview: 0, validated: 1 },
      { path: '/document-workspaces/DWS-0002', code: 'DWS-0002', name: 'Legal', defaultTags: 'legal', documents: 1, inbox: 0, inReview: 1, validated: 0 },
    ])
    expect(template(groupsTable.props.rows, data)).toEqual([
      { group: 'Finance / finance', documents: 2 },
      { group: 'Finance / invoice', documents: 1 },
      { group: 'Legal / legal', documents: 1 },
      { group: 'No workspace / untagged', documents: 1 },
    ])
    expect(template(groupedTable.props.rows, data).map(row => [row.workspace, row.tags, row.code])).toEqual([
      ['Finance', 'finance', 'DOC-3'], ['Finance', 'finance, invoice', 'DOC-1'], ['Legal', 'legal', 'DOC-2'], ['No workspace', 'untagged', 'DOC-4'],
    ])
  })

  it('splits validated and archived documents in the library', () => {
    const panels = stagePanels(documents['library.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.tabs'))
    expect(panels.map(panel => panel.slot)).toEqual(['validated', 'archived'])
    const [validatedTable] = panels[0].children
    const [archivedTable] = panels[1].children
    expect(template(validatedTable.props.rows, data).map(row => row.code)).toEqual(['DOC-3'])
    expect(template(archivedTable.props.rows, data).map(row => row.code)).toEqual(['DOC-4'])
  })
})
