import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, starterRecords, templates, threadStatuses } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
const unboundPages = ['home.page.yaml', 'channels.page.yaml', 'threads.page.yaml']

describe('Discuss Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('discuss.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/discuss/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/discuss/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the discussion action script from the thread form', () => {
    const document = documents['thread.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['post-message', 'resolve-thread', 'lock-thread', 'reopen-thread'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Locked threads lock their form: saving is disabled once the status is locked.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.status === 'locked'")
  })

  it('posts the compose draft with an idempotency key', () => {
    const post = steps(documents['thread.form.yaml']).filter(step => 'run-script' in step)
      .map(step => step['run-script']).find(run => run.parameters.operation === 'post-message')
    expect(post.parameters.body).toBe('{{ form.values.draft }}')
    expect(post.parameters.author).toBe('{{ form.values.postAs }}')
    expect(post.parameters.key).toBeTruthy()
  })

  it('archives the channel from the channel form and shows the message trail on the thread form', () => {
    const runs = steps(documents['channel.form.yaml']).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['archive-channel'])
    expect(runs[0]).toMatchObject({ file: postScriptPath })
    expect(JSON.stringify(documents['channel.form.yaml'].spec.tree)).toContain("form.values.status === 'archived'")
    expect(JSON.stringify(documents['thread.form.yaml'].spec.tree)).toContain('form.values.messages')
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

describe('Discuss manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('discuss.app.yaml').spec['file-access']

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
      const to = `${starter.kind === 'channel' ? containers.channels.path : containers.threads.path}/${starter.code}`
      expect(spec.install.find(entry => entry.to === to)).toMatchObject({
        from: `seed/starter/${starter.code}.json`, mode: 'seed', mime: mimeTypes[starter.kind],
      })
    }
    expect(spec.install.find(entry => entry.to === '/settings/discuss.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Discuss pages', () => {
  const thread = (code, status, lastActivityAt, messages = 1) => ({ kind: 'file', path: `/threads/${code}`, data: {
    code, state: 'active', subject: `Subject ${code}`, channel: '/channels/CH-0001', status,
    startedBy: 'Avery', messages: Array.from({ length: messages }, (_, i) => ({ sequence: i + 1 })), lastActivityAt,
  } })
  const data = {
    channels: [{ kind: 'file', path: '/channels/CH-0001', data: { state: 'active', code: 'CH-0001', name: 'General', visibility: 'public', topic: 'Chat', members: ['A', 'B'], status: 'active' } }],
    threads: [
      thread('TH-1', 'open', '2026-01-02T00:00:00Z', 3),
      thread('TH-2', 'open', '2026-01-05T00:00:00Z', 1),
      thread('TH-3', 'resolved', '2026-01-03T00:00:00Z', 2),
      { kind: 'file', path: '/threads/TH-4', data: { code: 'TH-4', state: 'archived', status: 'open', messages: [] } },
    ],
  }
  data.rows = evaluate(documents['threads.page.yaml'].spec.data.rows.expr, data)

  it('flattens active threads with their channel names and message counts', () => {
    expect(data.rows.map(row => [row.code, row.channel, row.messages])).toEqual([
      ['TH-1', 'General', 3], ['TH-2', 'General', 1], ['TH-3', 'General', 2],
    ])
  })

  it('lists threads by last activity, newest first and grouped by status', () => {
    const panels = documents['threads.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.tabs').children
    expect(panels.map(panel => panel.slot)).toEqual(threadStatuses)
    const open = panels.find(panel => panel.slot === 'open').children[0]
    expect(template(open.props.rows, data).map(row => row.code)).toEqual(['TH-2', 'TH-1'])
    expect(open.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit' } }])
  })

  it('sums open threads and last activity per channel on the channels page', () => {
    const tableNode = documents['channels.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.table')
    expect(template(tableNode.props.rows, data)).toEqual([{
      path: '/channels/CH-0001', code: 'CH-0001', name: 'General', visibility: 'public', topic: 'Chat',
      members: 2, status: 'active', open: 2, lastActivityAt: '2026-01-05T00:00:00Z',
    }])
  })
})
