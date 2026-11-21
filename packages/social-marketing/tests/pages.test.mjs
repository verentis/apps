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
const unboundPages = ['home.page.yaml', 'upcoming.page.yaml', 'engagement.page.yaml']

describe('Social Marketing Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('social-marketing.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/social-marketing/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/social-marketing/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the post action script from the post form', () => {
    const document = documents['post.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['schedule', 'publish', 'cancel'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
  })

  it('closes the post and content sections after publish but opens engagement for recording', () => {
    const tree = JSON.stringify(documents['post.form.yaml'].spec.tree)
    // The account, schedule and content freeze once the post is published or cancelled.
    expect(tree).toContain("form.values.status === 'published' || form.values.status === 'cancelled'")
    // Engagement is editable only once published, so the counts can be recorded by hand.
    expect(tree).toContain("!(form.values.status === 'published')")
    const controls = documents['post.form.yaml'].spec.tree.flatMap(function collect(node) {
      return [node, ...(node.children ?? []).flatMap(collect)]
    }).filter(node => node.type === 'canvas.form.number')
    expect(controls.map(control => control.props.value)).toEqual([
      '{{ form.values.engagement.likes }}', '{{ form.values.engagement.shares }}', '{{ form.values.engagement.comments }}',
    ])
    for (const control of controls) expect(control.rules.disabled).toContain("!(form.values.status === 'published')")
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

describe('Social Marketing manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('social-marketing.app.yaml').spec['file-access']

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
    expect(spec.install.find(entry => entry.to === '/settings/social-marketing.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Social Marketing report pages', () => {
  const account = (code, handle, network, active) => ({ kind: 'file', path: `/social-accounts/${code}`, data: {
    code, state: 'active', network, handle, active,
  } })
  const post = (code, status, account, extra = {}) => ({ kind: 'file', path: `/social-posts/${code}`, data: {
    code, state: 'active', account, content: `Content of ${code}`, mediaNote: '', status,
    scheduledDate: '', publishedAt: status === 'published' ? '2026-04-05T00:00:00Z' : '',
    engagement: { likes: 0, shares: 0, comments: 0 }, ...extra,
  } })
  const data = {
    accounts: [
      account('SOA-0001', '@verentis', 'mastodon', true),
      account('SOA-0002', 'Verentis Page', 'facebook', false),
    ],
    posts: [
      post('SOP-1', 'draft', '/social-accounts/SOA-0001'),
      post('SOP-2', 'scheduled', '/social-accounts/SOA-0001', { scheduledDate: '2026-04-02' }),
      post('SOP-3', 'scheduled', '/social-accounts/SOA-0002', { scheduledDate: '2026-04-01' }),
      post('SOP-4', 'published', '/social-accounts/SOA-0001', { engagement: { likes: 5, shares: 2, comments: 1 } }),
      post('SOP-5', 'published', '/social-accounts/SOA-0002', { engagement: { likes: 3, shares: 0, comments: 4 } }),
      post('SOP-6', 'cancelled', '/social-accounts/SOA-0001', { cancelledAt: '2026-04-03T00:00:00Z' }),
    ],
  }
  data.rows = evaluate(documents['home.page.yaml'].spec.data.rows.expr, data)

  it('counts posts by status and sums published likes on the home page', () => {
    const [publishedStat, scheduledStat, draftsStat, likesStat] = documents['home.page.yaml'].spec.tree[0].children
      .find(node => (node.children ?? []).some(child => child.type === 'canvas.dashboard.stat')).children
    expect(template(publishedStat.props.value, data)).toBe(2)
    expect(template(scheduledStat.props.value, data)).toBe(2)
    expect(template(draftsStat.props.value, data)).toBe(1)
    expect(template(likesStat.props.value, data)).toBe(8)
    expect(data.rows[0].handle).toBe('@verentis')
  })

  it('lists scheduled posts earliest first on the upcoming page', () => {
    const spec = documents['upcoming.page.yaml'].spec
    const [calendarTable] = spec.tree[0].children.find(node => node.type === 'canvas.card').children
    expect(template(calendarTable.props.rows, { ...data, rows: evaluate(spec.data.rows.expr, data) }).map(row => row.code))
      .toEqual(['SOP-3', 'SOP-2'])
    const panels = spec.tree[0].children.find(node => node.type === 'canvas.tabs').children
    expect(panels.map(panel => panel.slot)).toEqual(['draft', 'scheduled', 'published', 'cancelled'])
  })

  it('sums published posts and engagement per account on the engagement page', () => {
    const spec = documents['engagement.page.yaml'].spec
    const [accountsTable] = spec.tree[0].children.find(node => node.type === 'canvas.card').children
    expect(template(accountsTable.props.rows, { ...data, rows: evaluate(spec.data.rows.expr, data) })).toEqual([
      { path: '/social-accounts/SOA-0001', code: 'SOA-0001', handle: '@verentis', network: 'Mastodon', active: 'Yes',
        published: 1, likes: 5, shares: 2, comments: 1 },
      { path: '/social-accounts/SOA-0002', code: 'SOA-0002', handle: 'Verentis Page', network: 'Facebook', active: 'No',
        published: 1, likes: 3, shares: 0, comments: 4 },
    ])
  })
})
