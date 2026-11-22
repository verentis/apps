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

describe('Planning file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the publish and confirm stamps once reached', () => {
    expect(validators.shift(record('shift', { status: 'published' }))).toBe(false)
    expectValid('shift', record('shift', { status: 'published', publishedAt: now }))
    expect(validators.shift(record('shift', { status: 'confirmed', publishedAt: now }))).toBe(false)
    expectValid('shift', record('shift', { status: 'confirmed', publishedAt: now, confirmedAt: now }))
  })

  it('bounds shift times to HH:MM', () => {
    expectValid('shift', record('shift', { startTime: '08:00', endTime: '17:00' }))
    expect(validators.shift(record('shift', { startTime: '24:00' }))).toBe(false)
    expect(validators.shift(record('shift', { endTime: '5pm' }))).toBe(false)
  })
})
