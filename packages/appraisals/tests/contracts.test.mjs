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

describe('Appraisals file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the completion stamp once done and the cancellation stamp once cancelled', () => {
    expect(validators.appraisal(record('appraisal', { status: 'done', overallScore: '4.00' }))).toBe(false)
    expectValid('appraisal', record('appraisal', { status: 'done', overallScore: '4.00', completedAt: now }))
    expect(validators.appraisal(record('appraisal', { status: 'cancelled' }))).toBe(false)
    expectValid('appraisal', record('appraisal', { status: 'cancelled', cancelledAt: now }))
  })

  it('keeps ratings as criteria with scores 1 to 5 and the overall score a decimal string', () => {
    expectValid('appraisal', record('appraisal', { ratings: [{ criteria: 'Teamwork', score: '4' }] }))
    expect(validators.appraisal(record('appraisal', { ratings: [{ criteria: 'Teamwork', score: '6' }] }))).toBe(false)
    expect(validators.appraisal(record('appraisal', { ratings: [{ criteria: 'Teamwork', score: 4 }] }))).toBe(false)
    expect(validators.appraisal(record('appraisal', { ratings: [{ criteria: 'Teamwork' }] }))).toBe(false)
    expect(validators.appraisal(record('appraisal', { overallScore: 4.33 }))).toBe(false)
    expectValid('appraisal', record('appraisal', { overallScore: '4.33' }))
  })

  it('keeps the scheduled date an empty or ISO date', () => {
    expectValid('appraisal', record('appraisal', { scheduledAt: '' }))
    expectValid('appraisal', record('appraisal', { scheduledAt: '2026-04-01' }))
    expect(validators.appraisal(record('appraisal', { scheduledAt: '2026-04-01T00:00:00Z' }))).toBe(false)
  })
})
