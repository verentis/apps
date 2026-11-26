import { withUserProfile } from '../../../tools/file-apps/build.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, project, recordKinds, schemas, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])

describe('Timesheets Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('timesheets.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain(withUserProfile({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents] },
    }, pages))
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    for (const [name, schema] of Object.entries(schemas)) expect(JSON.parse(text(`schemas/${name}.schema.json`)), name).toEqual(plain(schema))
    for (const [name, template] of Object.entries(templates)) expect(JSON.parse(text(`templates/${name}.json`)), name).toEqual(plain(template))
  })

  it.each(recordKinds)('binds an editable form with derived registration to %s files', kind => {
    const bind = binds.find(candidate => candidate.pattern === mimeTypes[kind])
    expect(bind?.mode).toBe('edit')
    expect(bind['json-schema'].source).toBe(`/applications/timesheets/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/timesheets/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the validation script from the entry form', () => {
    const document = documents['entry.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['validate-entry'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // The script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
  })

  it('offers Project work on the entry form as an optional dependency', () => {
    const document = documents['entry.form.yaml']
    expect(document.spec.data.projects).toMatchObject({ kind: 'folder', path: project.projects, 'mime-pattern': project.projectMime })
    expect(document.spec.data.tasks).toMatchObject({ kind: 'folder', path: project.tasks, 'mime-pattern': project.taskMime })
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/project', version: 'latest', optional: true })
  })

  it('leaves the entries container to the file browser and offers its records in New', () => {
    expect(binds.some(candidate => candidate.pattern === mimeTypes.entries)).toBe(false)
    const offered = manifest.spec.creatables.filter(creatable => creatable.parents?.includes(mimeTypes.entries)).map(creatable => creatable.mime)
    expect(offered).toEqual(containers.entries.holds.map(kind => mimeTypes[kind]))
  })

  it('declares every folder the unbound pages read', () => {
    for (const file of ['home.page.yaml', 'week.page.yaml']) {
      const { spec } = documents[file]
      const granted = spec.access.map(grant => grant.path)
      for (const source of Object.values(spec.data).filter(source => source.kind === 'folder')) expect(granted, `${file} ${source.path}`).toContain(source.path)
    }
  })

  it('sums this week\'s hours by project', () => {
    const { spec } = documents['week.page.yaml']
    const today = new Date().toISOString().slice(0, 10)
    const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
    const entry = (code, project, hours, status, date = today) => ({ kind: 'file', path: `/timesheets/${code}`, data: {
      code, state: 'active', employee: 'Thandi', date, project, hours, status,
    } })
    const data = {
      projects: [{ kind: 'file', path: '/projects/PROJ-0001', data: { name: 'Apollo' } }],
      entries: [
        entry('TS-1', '/projects/PROJ-0001', '7.5', 'validated'),
        entry('TS-2', '/projects/PROJ-0001', '0.25', 'draft'),
        entry('TS-3', '', '2', 'draft'),
        entry('TS-4', '/projects/PROJ-0001', '8', 'validated', '2000-01-01'),
      ],
    }
    const weekly = new Function('data', 'Date', `return (${spec.data.weekly.expr})`)(data, canvasDate)
    expect(weekly).toEqual([
      { key: '/projects/PROJ-0001', project: 'Apollo', entries: 2, validated: 75000, draft: 2500 },
      { key: '', project: '(no project)', entries: 1, validated: 0, draft: 20000 },
    ])
  })
})

describe('Timesheets manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('timesheets.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine, and optionally Project', () => {
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/project', version: 'latest', optional: true },
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

  it('seeds the container and settings once', () => {
    const directive = spec.install.find(entry => entry.to === containers.entries.path)
    expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes.entries })
    expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    expect(spec.install.find(entry => entry.to === '/settings/timesheets.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const entry of spec.install) expect(files.some(pattern => pattern.test(entry.from.replace(/\*/g, 'x'))), entry.from).toBe(true)
  })
})
