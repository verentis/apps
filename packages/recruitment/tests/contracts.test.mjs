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

describe('Recruitment file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the refusal reason once refused and the hire stamp once hired', () => {
    expect(validators.candidate(record('candidate', { stage: 'hired' }))).toBe(false)
    expectValid('candidate', record('candidate', { stage: 'hired', hiredAt: now }))
    const { refusalReason: _reason, ...refusedWithout } = record('candidate', { stage: 'refused' })
    expect(validators.candidate(refusedWithout)).toBe(false)
    expectValid('candidate', record('candidate', { stage: 'refused', refusalReason: 'Position filled' }))
  })

  it('keeps the expected salary an exact decimal string', () => {
    expectValid('candidate', record('candidate', { expectedSalary: '' }))
    expectValid('candidate', record('candidate', { expectedSalary: '45000.00' }))
    expect(validators.candidate(record('candidate', { expectedSalary: 45000 }))).toBe(false)
    expect(validators.candidate(record('candidate', { expectedSalary: 'a lot' }))).toBe(false)
  })

  it('bounds a position\'s openings to whole non-negative counts', () => {
    expect(validators.job(record('job', { openings: -1 }))).toBe(false)
    expect(validators.job(record('job', { openings: 1.5 }))).toBe(false)
    expectValid('job', record('job', { openings: 0 }))
    expect(validators.job(record('job', { status: 'draft' }))).toBe(false)
  })
})
