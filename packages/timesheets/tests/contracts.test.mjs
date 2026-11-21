import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, templates } from '../src/contracts.mjs'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, ajv.compile(schema)]))
const id = '0b6f4c1e-8a7d-4f2b-9c3e-5d6a7b8c9d0e'
const now = '2026-01-02T03:04:05Z'

function record(kind, values = {}) {
  const filled = JSON.parse(fillTemplate(readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8'), { id, now, name: 'Example' }))
  return { ...filled, code: 'X-0001', ...values }
}

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('Timesheets file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('keeps hours as exact decimal strings', () => {
    expectValid('entry', record('entry', { hours: '7.5' }))
    expect(validators.entry(record('entry', { hours: 7.5 }))).toBe(false)
    expect(validators.entry(record('entry', { hours: '-1' }))).toBe(false)
    expect(validators.entry(record('entry', { hours: '07.5' }))).toBe(false)
  })

  it('requires the validation stamp once validated', () => {
    expect(validators.entry(record('entry', { status: 'validated' }))).toBe(false)
    expectValid('entry', record('entry', { status: 'validated', validatedAt: now, hours: '8' }))
    expect(validators.entry(record('entry', { status: 'approved' }))).toBe(false)
  })

  it('keeps project and task references as workspace paths', () => {
    expectValid('entry', record('entry', { project: '/projects/PROJ-0001', task: '/tasks/TASK-0001' }))
    expect(validators.entry(record('entry', { project: 'PROJ-0001' }))).toBe(false)
    expect(validators.entry(record('entry', { task: 'TASK-0001' }))).toBe(false)
  })
})
