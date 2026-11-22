import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { fillTemplate, recordKinds, schemas, templates } from '../src/contracts.mjs'

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

describe('Maintenance file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('keeps duration hours as an exact decimal string and dates as plain dates', () => {
    expectValid('request', record('request', { durationHours: '1.5', scheduledDate: '2026-02-01' }))
    expect(validators.request(record('request', { durationHours: 1.5 }))).toBe(false)
    expect(validators.request(record('request', { durationHours: '-1' }))).toBe(false)
    expect(validators.request(record('request', { scheduledDate: 'soon' }))).toBe(false)
    expectValid('equipment', record('equipment', { purchaseDate: '2024-06-01', warrantyEnd: '2027-06-01' }))
    expect(validators.equipment(record('equipment', { warrantyEnd: 'next year' }))).toBe(false)
  })

  it('requires the audit trail as a request moves through its stages', () => {
    expect(validators.request(record('request', { stage: 'in-progress' }))).toBe(false)
    expectValid('request', record('request', { stage: 'in-progress', startedAt: now }))
    expect(validators.request(record('request', { stage: 'repaired', startedAt: now }))).toBe(false)
    expectValid('request', record('request', { stage: 'repaired', startedAt: now, completedAt: now }))
    expect(validators.request(record('request', { stage: 'scrap' }))).toBe(false)
    expectValid('request', record('request', { stage: 'scrap', scrappedAt: now }))
  })

  it('rejects unknown fields, unknown enums and non-UTC instants', () => {
    expect(validators.request(record('request', { severity: 'high' }))).toBe(false)
    expect(validators.request(record('request', { stage: 'paused' }))).toBe(false)
    expect(validators.request(record('request', { type: 'predictive' }))).toBe(false)
    expect(validators.equipment(record('equipment', { status: 'broken' }))).toBe(false)
    expect(validators.equipment(record('equipment', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
