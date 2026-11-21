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
const unboundPages = ['home.page.yaml', 'surveys.page.yaml', 'results.page.yaml']

describe('Surveys Canvas documents', () => {
  // The committed manifest and Canvas documents are YAML renderings of what src/build.mjs models; CI owns the
  // manifest's metadata.version.
  it('are up to date with the generator', () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('surveys.app.yaml')
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
    expect(bind['json-schema'].source).toBe(`/applications/surveys/schemas/${kind}.schema.json`)
    const { spec } = bind.document
    expect(spec.data.record).toEqual({ kind: 'document', consistency: 'conditional' })
    expect(spec.entry).toBe(`\${var:canvas-origin}/render?document=${encodeURIComponent(`/applications/surveys/canvas/${kind}.form.yaml`)}`)
    expect(steps(bind.document).some(step => 'save' in step)).toBe(true)
    for (const grant of spec.access) expect(grant.mode ?? 'read').toBe('read')
  })

  it('runs the action script from the survey and response forms', () => {
    const surveyRuns = steps(documents['survey.form.yaml']).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(surveyRuns.map(run => run.parameters.operation)).toEqual(['open', 'close'])
    const responseRuns = steps(documents['response.form.yaml']).filter(step => 'run-script' in step).map(step => step['run-script'])
    expect(responseRuns.map(run => run.parameters.operation)).toEqual(['submit'])
    for (const run of [...surveyRuns, ...responseRuns]) {
      expect(run).toMatchObject({ file: postScriptPath, parameters: { path: '{{ ctx.file.path }}' } })
    }
    for (const file of ['survey.form.yaml', 'response.form.yaml']) {
      expect(documents[file].spec.permissions).toEqual(expect.arrayContaining(['execution.run']))
      // A script reloads the record afterwards, which a dirty form would refuse.
      expect(JSON.stringify(documents[file].spec.tree)).toMatch(/form\.saving \|\| form\.dirty/)
    }
    // Closed surveys and submitted responses lock their forms.
    const locked = expression => JSON.stringify(expression).slice(1, -1)
    expect(JSON.stringify(documents['survey.form.yaml'].spec.tree)).toContain(locked("form.values.status === 'closed'"))
    expect(JSON.stringify(documents['response.form.yaml'].spec.tree)).toContain(locked("form.values.status === 'submitted'"))
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

describe('Surveys manifest', () => {
  const { spec } = manifest
  const files = manifest.packaging.files.map(globToRegExp)
  const consent = read('surveys.app.yaml').spec['file-access']

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
    expect(spec.install.find(entry => entry.to === '/settings/surveys.json')).toMatchObject({ mode: 'seed', mime: mimeTypes.settings })
    for (const directive of spec.install) expect(files.some(pattern => pattern.test(directive.from.replace(/\*/g, 'x'))), directive.from).toBe(true)
  })
})

// Canvas expressions are a JavaScript subset in which `Date()` returns an ISO timestamp.
const canvasDate = Object.assign(value => (value === undefined ? new Date() : new Date(value)).toISOString(), { now: Date.now })
const evaluate = (expression, data) => new Function('data', 'Date', `return (${expression})`)(data, canvasDate)
const template = (value, data) => /^\{\{ (.*) \}\}$/s.test(value)
  ? evaluate(value.slice(3, -3), data)
  : value.replace(/\{\{ (.*?) \}\}/g, (_, expression) => evaluate(expression, data))

describe('Surveys report pages', () => {
  const survey = (code, status, questions) => ({ kind: 'file', path: `/surveys/${code}`, data: {
    code, state: 'active', title: `Survey ${code}`, status, questions,
  } })
  const response = (code, surveyPath, status, answers, state = 'active') => ({ kind: 'file', path: `/survey-responses/${code}`, data: {
    code, state, survey: surveyPath, status, answers,
  } })
  const data = {
    surveys: [
      survey('SUR-1', 'open', [
        { sequence: 1, text: 'Overall?', kind: 'rating', choices: [], required: true },
        { sequence: 2, text: 'Channel?', kind: 'single-choice', choices: ['Web', 'Email'], required: true },
        { sequence: 3, text: 'Topics?', kind: 'multi-choice', choices: ['Docs', 'API'], required: false },
        { sequence: 4, text: 'Anything else?', kind: 'text', choices: [], required: false },
      ]),
      survey('SUR-2', 'draft', [{ sequence: 1, text: 'Later?', kind: 'text', choices: [], required: false }]),
    ],
    responses: [
      response('SRS-1', '/surveys/SUR-1', 'submitted', [
        { sequence: 1, value: '4' }, { sequence: 2, value: 'Web' }, { sequence: 3, values: ['Docs', 'API'] }, { sequence: 4, value: 'Nice' },
      ]),
      response('SRS-2', '/surveys/SUR-1', 'submitted', [
        { sequence: 1, value: '5' }, { sequence: 2, value: 'Web' }, { sequence: 3, values: ['Docs'] }, { sequence: 4, value: '' },
      ]),
      response('SRS-3', '/surveys/SUR-1', 'draft', [{ sequence: 1, value: '1' }]),
      response('SRS-4', '/surveys/SUR-1', 'submitted', [{ sequence: 1, value: '3' }], 'archived'),
    ],
  }
  const spec = documents['results.page.yaml'].spec
  data.rows = evaluate(spec.data.rows.expr, data)
  data.results = evaluate(spec.data.results.expr, data)

  it('counts questions and submitted responses per survey, ignoring drafts and archived responses', () => {
    expect(data.rows.map(row => [row.code, row.questions, row.submitted, row.drafts])).toEqual([
      ['SUR-1', 4, 2, 1], ['SUR-2', 1, 0, 0],
    ])
  })

  it('tallies choices, averages ratings and counts text answers over the submitted responses', () => {
    expect(data.results).toEqual([
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Overall?', metric: 'Average rating', value: '4.5' },
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Channel?', metric: 'Web', value: 2 },
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Channel?', metric: 'Email', value: 0 },
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Topics?', metric: 'Docs', value: 2 },
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Topics?', metric: 'API', value: 1 },
      { path: '/surveys/SUR-1', survey: 'SUR-1', question: 'Anything else?', metric: 'Answered', value: 1 },
      { path: '/surveys/SUR-2', survey: 'SUR-2', question: 'Later?', metric: 'Answered', value: 0 },
    ])
  })

  it('groups surveys by status on the surveys page', () => {
    const page = documents['surveys.page.yaml']
    const panels = page.spec.tree[0].children.find(node => node.type === 'canvas.tabs').children
    expect(panels.map(panel => panel.slot)).toEqual(['draft', 'open', 'closed'])
    const open = panels.find(panel => panel.slot === 'open').children[0]
    expect(template(open.props.rows, data).map(row => row.code)).toEqual(['SUR-1'])
  })

  it('counts the submitted responses on the survey form', () => {
    const tree = JSON.stringify(documents['survey.form.yaml'].spec.tree)
    expect(tree).toContain('Submitted responses')
    expect(documents['survey.form.yaml'].spec.data.responses).toMatchObject({ kind: 'folder', path: '/survey-responses' })
  })
})
