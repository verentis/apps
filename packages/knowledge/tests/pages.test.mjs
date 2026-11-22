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
const unboundPages = ['home.page.yaml', 'spaces.page.yaml', 'recent.page.yaml', 'tags.page.yaml']

describe('Knowledge Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('knowledge.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/knowledge/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/knowledge/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the article action script from the article form', () => {
    const document = documents['article.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['publish', 'archive', 'restore'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Archived articles lock their form: saving is disabled once the status is archived.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.status === 'archived'")
  })

  it('edits the Markdown body as a multiline string instead of inventing a rich-text format', () => {
    const body = JSON.stringify(documents['article.form.yaml'].spec.tree)
    expect(body).toContain('canvas.form.textarea')
    expect(body).toContain('Markdown')
    expect(schemas.article.properties.body.contentMediaType).toBe('text/markdown')
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

describe('Knowledge manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('knowledge.app.yaml').spec['file-access']

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
      const to = `${starter.kind === 'space' ? containers.spaces.path : containers.articles.path}/${starter.code}`
      expect(spec.install.find(entry => entry.to === to)).toMatchObject({
        from: `seed/starter/${starter.code}.json`, mode: 'seed', mime: mimeTypes[starter.kind],
      })
    }
    expect(spec.install.find(entry => entry.to === '/settings/knowledge.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Knowledge report pages', () => {
  const article = (code, values = {}) => ({ kind: 'file', path: `/articles/${code}`, data: {
    code, state: 'active', title: `Title ${code}`, space: '/knowledge-spaces/KS-0001', parent: '',
    status: 'draft', tags: [], owner: '', updatedAt: '2026-01-01T00:00:00Z', ...values,
  } })
  const data = {
    spaces: [
      { kind: 'file', path: '/knowledge-spaces/KS-0001', data: { state: 'active', code: 'KS-0001', name: 'Handbook', icon: 'book', description: 'The handbook' } },
      { kind: 'file', path: '/knowledge-spaces/KS-0002', data: { state: 'active', code: 'KS-0002', name: 'Engineering', description: '' } },
    ],
    articles: [
      article('KA-0001', { status: 'published', tags: ['handbook'], updatedAt: '2026-01-03T00:00:00Z' }),
      article('KA-0002', { parent: '/articles/KA-0001', status: 'published', tags: ['handbook', 'workspace'], updatedAt: '2026-01-04T00:00:00Z' }),
      article('KA-0003', { tags: ['policy'], updatedAt: '2026-01-05T00:00:00Z' }),
      article('KA-0004', { space: '/knowledge-spaces/KS-0002', status: 'archived', tags: ['handbook'], updatedAt: '2026-01-02T00:00:00Z' }),
      { kind: 'file', path: '/articles/KA-0005', data: { code: 'KA-0005', state: 'archived', title: 'Gone', status: 'draft', tags: [] } },
    ],
  }
  data.rows = evaluate(documents['spaces.page.yaml'].spec.data.rows.expr, data)

  it('flattens active articles with their space name and parent code', () => {
    expect(data.rows.map(row => row.code)).toEqual(['KA-0001', 'KA-0002', 'KA-0003', 'KA-0004'])
    expect(data.rows[0].space).toBe('Handbook')
    expect(data.rows[1].parentCode).toBe('KA-0001')
    expect(data.rows[3].space).toBe('Engineering')
  })

  it('groups articles by space and sorts a nested article directly after its parent, indented', () => {
    const cards = documents['spaces.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const grouped = template(cards[1].children[0].props.rows, data)
    expect(grouped.map(row => [row.space, row.article])).toEqual([
      ['Engineering', 'Title KA-0004'],
      ['Handbook', 'Title KA-0001'],
      ['Handbook', '\u21b3 Title KA-0002'],
      ['Handbook', 'Title KA-0003'],
    ])
    const spacesTable = template(cards[0].children[0].props.rows, data)
    expect(spacesTable).toEqual([
      { path: '/knowledge-spaces/KS-0001', space: 'Handbook', icon: 'book', description: 'The handbook', articles: 3, published: 2, drafts: 1 },
      { path: '/knowledge-spaces/KS-0002', space: 'Engineering', icon: '', description: '', articles: 1, published: 0, drafts: 0 },
    ])
  })

  it('lists the most recently updated articles first', () => {
    const tableNode = documents['recent.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.table')
    expect(template(tableNode.props.rows, data).map(row => row.code)).toEqual(['KA-0003', 'KA-0002', 'KA-0001', 'KA-0004'])
    expect(tableNode.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit' } }])
  })

  it('sums articles per tag by status', () => {
    const cards = documents['tags.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    expect(template(cards[0].children[0].props.rows, data)).toEqual([
      { tag: 'handbook', articles: 3, published: 2, drafts: 0, archived: 1 },
      { tag: 'policy', articles: 1, published: 0, drafts: 1, archived: 0 },
      { tag: 'workspace', articles: 1, published: 1, drafts: 0, archived: 0 },
    ])
  })
})
