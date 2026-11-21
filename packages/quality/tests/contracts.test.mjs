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

describe('Quality file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('keeps measures and tolerances as exact decimal strings and active as a boolean', () => {
    expectValid('point', record('point', { checkType: 'measure', measureTarget: '12.5', toleranceMin: '12', toleranceMax: '13' }))
    expect(validators.point(record('point', { measureTarget: 12.5 }))).toBe(false)
    expect(validators.point(record('point', { toleranceMin: -1 }))).toBe(false)
    expect(validators.point(record('point', { active: 'true' }))).toBe(false)
    expectValid('check', record('check', { measuredValue: '12.75' }))
    expect(validators.check(record('check', { measuredValue: 12.75 }))).toBe(false)
  })

  it('requires the audit trail as a check is recorded', () => {
    expect(validators.check(record('check', { result: 'pass' }))).toBe(false)
    expectValid('check', record('check', { result: 'pass', checkedAt: now }))
    expect(validators.check(record('check', { result: 'fail' }))).toBe(false)
    expectValid('check', record('check', { result: 'fail', checkedAt: now, alert: '/quality-alerts/X-0001-AL' }))
  })

  it('requires the analysis as an alert is resolved', () => {
    expect(validators.alert(record('alert', { stage: 'resolved' }))).toBe(false)
    expect(validators.alert(record('alert', { stage: 'resolved', rootCause: 'Worn tool', correctiveAction: 'Replaced' }))).toBe(false)
    expectValid('alert', record('alert', { stage: 'resolved', rootCause: 'Worn tool', correctiveAction: 'Replaced', resolvedAt: now }))
    expectValid('alert', record('alert', { stage: 'investigation', sourceCheck: '/quality-checks/QCK-0001' }))
  })

  it('rejects unknown fields, unknown enums and non-UTC instants', () => {
    expect(validators.check(record('check', { severity: 'high' }))).toBe(false)
    expect(validators.check(record('check', { result: 'maybe' }))).toBe(false)
    expect(validators.alert(record('alert', { stage: 'escalated' }))).toBe(false)
    expect(validators.point(record('point', { checkType: 'visual' }))).toBe(false)
    expect(validators.point(record('point', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
