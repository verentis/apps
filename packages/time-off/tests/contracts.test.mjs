import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, starterRecords, templates } from '../src/contracts.mjs'

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

describe('Time Off file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.filter(starter => starter.kind === 'type').length).toBeGreaterThanOrEqual(2)
    expect(starterRecords.some(starter => starter.kind === 'request' && starter.status === 'draft')).toBe(true)
  })

  it('requires the submission, approval and refusal trails per status', () => {
    expect(validators.request(record('request', { status: 'submitted' }))).toBe(false)
    expectValid('request', record('request', { status: 'submitted', submittedAt: now }))
    expect(validators.request(record('request', { status: 'approved', submittedAt: now }))).toBe(false)
    expectValid('request', record('request', { status: 'approved', submittedAt: now, approver: 'Jordan', approvedAt: now }))
    expect(validators.request(record('request', { status: 'refused', submittedAt: now }))).toBe(false)
    expectValid('request', record('request', { status: 'refused', submittedAt: now, refusalReason: 'Coverage', refusedAt: now }))
  })

  it('keeps days an empty or non-negative decimal string', () => {
    expectValid('request', record('request', { days: '' }))
    expectValid('request', record('request', { days: '2.5' }))
    expect(validators.request(record('request', { days: '-1' }))).toBe(false)
    expect(validators.request(record('request', { days: 'five' }))).toBe(false)
    expect(validators.request(record('request', { days: 5 }))).toBe(false)
  })

  it('keeps requiresApproval a boolean and daysPerYear a decimal string', () => {
    expectValid('type', record('type', { requiresApproval: false, daysPerYear: '15' }))
    expect(validators.type(record('type', { requiresApproval: 'yes' }))).toBe(false)
    expect(validators.type(record('type', { daysPerYear: 'many' }))).toBe(false)
  })
})
