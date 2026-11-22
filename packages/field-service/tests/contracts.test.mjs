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
  return { ...filled, code: 'FST-0001', ...values }
}

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('Field Service file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the completion and cancellation stamps once reached', () => {
    expect(validators.task(record('task', { stage: 'done' }))).toBe(false)
    expectValid('task', record('task', { stage: 'done', hours: '2.5', materialsTotal: '0.00', completedAt: now }))
    expect(validators.task(record('task', { stage: 'cancelled' }))).toBe(false)
    expectValid('task', record('task', { stage: 'cancelled', cancelledAt: now }))
  })

  it('keeps hours, quantities and money as decimal strings, never numbers', () => {
    expect(validators.task(record('task', { hours: 2.5 }))).toBe(false)
    expect(validators.task(record('task', { materials: [{ description: 'Filter', quantity: 2, unitPrice: '10.00' }] }))).toBe(false)
    expectValid('task', record('task', { hours: '2.5', materials: [{ description: 'Filter', quantity: '2', unitPrice: '10.00' }] }))
  })

  it('bounds the time window to HH:MM times', () => {
    expectValid('task', record('task', { windowStart: '08:00', windowEnd: '10:30' }))
    expect(validators.task(record('task', { windowStart: '25:00' }))).toBe(false)
    expect(validators.task(record('task', { windowEnd: '8am' }))).toBe(false)
  })
})
