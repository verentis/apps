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

describe('Project file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('accepts the project statuses and rejects anything else', () => {
    for (const status of ['active', 'on-hold', 'done']) expectValid('project', record('project', { status }))
    expect(validators.project(record('project', { status: 'cancelled' }))).toBe(false)
  })

  it('requires the completion stamp once a task is done', () => {
    expect(validators.task(record('task', { stage: 'done' }))).toBe(false)
    expectValid('task', record('task', { stage: 'done', completedAt: now }))
    expect(validators.task(record('task', { stage: 'later' }))).toBe(false)
    expect(validators.task(record('task', { priority: 'whenever' }))).toBe(false)
  })

  it('keeps references as workspace paths', () => {
    expectValid('task', record('task', { project: '/projects/PROJ-0001' }))
    expect(validators.task(record('task', { project: 'PROJ-0001' }))).toBe(false)
    expect(validators.project(record('project', { customerRef: 'CUST-0001' }))).toBe(false)
  })
})
