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

describe('Referrals file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
    expect(validators.settings({ ...defaultSettings, hirePoints: '100' })).toBe(false)
    expect(validators.settings({ ...defaultSettings, hirePoints: -1 })).toBe(false)
  })

  it('requires the decision stamp once hired or not hired', () => {
    expect(validators.referral(record('referral', { status: 'hired', points: 100 }))).toBe(false)
    expectValid('referral', record('referral', { status: 'hired', points: 100, decidedAt: now }))
    expect(validators.referral(record('referral', { status: 'not-hired' }))).toBe(false)
    expectValid('referral', record('referral', { status: 'not-hired', decidedAt: now }))
  })

  it('keeps points a non-negative integer and the job and referrer references paths', () => {
    expect(validators.referral(record('referral', { points: '100' }))).toBe(false)
    expect(validators.referral(record('referral', { points: -1 }))).toBe(false)
    expectValid('referral', record('referral', { job: '/job-positions/JOB-0001', referrerRef: '/employees/EMP-0001' }))
    expect(validators.referral(record('referral', { job: 'JOB-0001' }))).toBe(false)
    expect(validators.referral(record('referral', { status: 'interviewing' }))).toBe(false)
  })
})
