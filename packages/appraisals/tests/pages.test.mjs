import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { stagePanels } from '../../../tools/file-apps/test-helpers.mjs'
import {
  createScriptFileAccess, createScriptName, featureOverlay, manifest, postScriptFileAccess, postScriptName,
  postScriptPath, productionOverlay, scriptConsents,
} from '../src/app.mjs'
import { containers, mimeTypes, recordKinds, schemas, statuses, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const binds = Object.values(documents).flatMap(document => (document.spec.binds ?? []).map(bind => ({ document, ...bind })))
const globToRegExp = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`)
const steps = document => Object.values(document.spec.actions ?? {}).flatMap(action => action.steps ?? [])
const unboundPages = ['home.page.yaml', 'appraisals.page.yaml', 'scores.page.yaml']

describe('Appraisals Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('appraisals.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/appraisals/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/appraisals/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the appraisal action script from the appraisal form', () => {
    const document = documents['appraisal.form.yaml']
    const runs = steps(document).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(runs.map(run => run.parameters.operation)).toEqual(['schedule', 'complete'])
    for (const run of runs) expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    expect(document.spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
    // A script reloads the record afterwards, which a dirty form would refuse.
    expect(JSON.stringify(document.spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    // Done appraisals lock their form, and Complete needs non-empty ratings.
    expect(JSON.stringify(document.spec.tree)).toContain("form.values.status === 'done'")
    expect(JSON.stringify(document.spec.tree)).toContain('!(form.values.ratings || []).length')
  })

  it('offers Employees records on appraisals without requiring Employees', () => {
    const document = documents['appraisal.form.yaml']
    expect(document.spec.data.employeerecords).toMatchObject({ kind: 'folder', path: '/employees' })
    const patch = document.spec.actions['copy-employee'].steps[0]['patch-form'].values.employeeName
    expect(patch).toContain('form.values.employeeRef')
    expect(manifest.spec.dependencies).toContainEqual({ package: 'verentis/employees', version: 'latest', optional: true })
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

describe('Appraisals manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('appraisals.app.yaml').spec['file-access']

  it('depends on the latest Canvas and nodejs engine, and optionally Employees', () => {
    expect(manifest.metadata.version).toBe('0.1.0')
    expect(spec.dependencies).toEqual([
      { package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/employees', version: 'latest', optional: true },
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
    for (const [name, container] of Object.entries(containers)) {
      const directive = spec.install.find(entry => entry.to === container.path)
      expect(directive).toMatchObject({ mode: 'seed', mime: mimeTypes[name] })
      expect(readFileSync(new URL(directive.from, root), 'utf8')).toBe('')
    }
    expect(spec.install.find(entry => entry.to === '/settings/appraisals.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Appraisals report pages', () => {
  const appraisal = (code, status, overallScore = '', manager = 'Sipho') => ({ kind: 'file', path: `/appraisals/${code}`, data: {
    code, state: 'active', employeeName: `Employee ${code}`, period: '2026-H1', manager, status,
    scheduledAt: '2026-04-01', ratings: [{ criteria: 'Teamwork', score: '4' }], overallScore,
  } })
  const data = {
    appraisals: [
      appraisal('APR-1', 'draft'),
      appraisal('APR-2', 'scheduled'),
      appraisal('APR-3', 'done', '4.50'),
      appraisal('APR-4', 'done', '3.50', 'Lindiwe'),
      appraisal('APR-5', 'cancelled'),
    ],
  }
  data.rows = evaluate(documents['scores.page.yaml'].spec.data.rows.expr, data)

  it('groups appraisals by status on the list page', () => {
    const page = documents['appraisals.page.yaml']
    const panels = stagePanels(page.spec.tree[0].children.find(node => node.type === 'canvas.tabs'))
    expect(panels.map(panel => panel.slot)).toEqual(statuses)
    const scheduled = panels.find(panel => panel.slot === 'scheduled').children[0]
    expect(template(scheduled.props.rows, data).map(row => row.code)).toEqual(['APR-2'])
    expect(scheduled.on['row-click']).toEqual([{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }])
  })

  it('lists completed appraisals by overall score and averages per manager', () => {
    const cards = documents['scores.page.yaml'].spec.tree[0].children.filter(node => node.type === 'canvas.card')
    const [scoresTable] = cards[0].children
    const [managersTable] = cards[1].children
    expect(template(scoresTable.props.rows, data).map(row => [row.code, row.overallScore])).toEqual([
      ['APR-3', '4.50'], ['APR-4', '3.50'],
    ])
    expect(template(managersTable.props.rows, data)).toEqual([
      { manager: 'Lindiwe', done: 1, average: '3.50' },
      { manager: 'Sipho', done: 1, average: '4.50' },
    ])
  })

  it('averages completed scores in integer hundredths on the stats', () => {
    const statNodes = documents['scores.page.yaml'].spec.tree[0].children.find(node => node.type === 'canvas.grid').children
    const average = statNodes.find(node => node.props.label === 'Average score')
    expect(template(average.props.value, data)).toBe('4.00')
    const empty = { appraisals: [], rows: [] }
    expect(template(average.props.value, empty)).toBe('—')
  })
})
