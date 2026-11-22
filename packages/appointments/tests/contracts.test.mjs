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

describe('Appointments file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the status stamps once a status is reached', () => {
    expect(validators.appointment(record('appointment', { status: 'confirmed' }))).toBe(false)
    expectValid('appointment', record('appointment', { status: 'confirmed', confirmedAt: now }))
    expect(validators.appointment(record('appointment', { status: 'done', confirmedAt: now }))).toBe(false)
    expectValid('appointment', record('appointment', { status: 'done', confirmedAt: now, completedAt: now }))
    expect(validators.appointment(record('appointment', { status: 'cancelled' }))).toBe(false)
    expectValid('appointment', record('appointment', { status: 'cancelled', cancelledAt: now }))
    expect(validators.appointment(record('appointment', { status: 'no-show' }))).toBe(false)
    expectValid('appointment', record('appointment', { status: 'no-show', noShowAt: now }))
  })

  it('bounds appointment times to HH:MM and the type duration to minutes', () => {
    expectValid('appointment', record('appointment', { startTime: '09:00', endTime: '09:30' }))
    expect(validators.appointment(record('appointment', { startTime: '24:00' }))).toBe(false)
    expect(validators.appointment(record('appointment', { endTime: '9am' }))).toBe(false)
    expect(validators.type(record('type', { durationMinutes: 0 }))).toBe(false)
    expect(validators.type(record('type', { durationMinutes: '30' }))).toBe(false)
    expect(validators.type(record('type', { bufferMinutes: 500 }))).toBe(false)
  })
})
