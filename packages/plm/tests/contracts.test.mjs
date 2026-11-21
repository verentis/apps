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
  return { ...filled, code: 'ECO-0001', ...values }
}

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('PLM file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('requires the audit trail as a change order moves forward', () => {
    expect(validators.eco(record('eco', { stage: 'in-review' }))).toBe(false)
    expectValid('eco', record('eco', { stage: 'in-review', submittedAt: now }))
    expect(validators.eco(record('eco', { stage: 'approved', submittedAt: now, approvedAt: now }))).toBe(false)
    expectValid('eco', record('eco', { stage: 'approved', submittedAt: now, approvedAt: now, approver: 'Ada' }))
    expect(validators.eco(record('eco', { stage: 'applied', submittedAt: now, approvedAt: now, approver: 'Ada', appliedAt: now }))).toBe(false)
    expectValid('eco', record('eco', {
      stage: 'applied', submittedAt: now, approvedAt: now, approver: 'Ada', appliedAt: now, effectiveDate: '2026-02-01',
    }))
    expect(validators.eco(record('eco', { stage: 'rejected', submittedAt: now, rejectedAt: now }))).toBe(false)
    expectValid('eco', record('eco', { stage: 'rejected', submittedAt: now, rejectedAt: now, rejectionReason: 'Too costly' }))
  })

  it('rejects unknown fields, stages, types and non-UTC instants', () => {
    expect(validators.eco(record('eco', { reviewer: 'Ada' }))).toBe(false)
    expect(validators.eco(record('eco', { stage: 'pending' }))).toBe(false)
    expect(validators.eco(record('eco', { type: 'retire' }))).toBe(false)
    expect(validators.eco(record('eco', { priority: 'critical' }))).toBe(false)
    expect(validators.eco(record('eco', { effectiveDate: 'tomorrow' }))).toBe(false)
    expect(validators.eco(record('eco', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
