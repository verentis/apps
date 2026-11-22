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

describe('Fleet file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
  })

  it('keeps money and kilometres as exact decimal strings', () => {
    expectValid('vehicle', record('vehicle', { odometerKm: '45200.5' }))
    expect(validators.vehicle(record('vehicle', { odometerKm: 45200.5 }))).toBe(false)
    expect(validators.vehicle(record('vehicle', { odometerKm: '-1' }))).toBe(false)
    expect(validators.vehicle(record('vehicle', { odometerKm: '1.23456' }))).toBe(false)
    expect(validators.contract(record('contract', { monthlyCost: 650 }))).toBe(false)
    expect(validators.service(record('service', { cost: 120 }))).toBe(false)
  })

  it('requires the audit trail once done or retired', () => {
    expect(validators.service(record('service', { status: 'done' }))).toBe(false)
    expectValid('service', record('service', { status: 'done', doneAt: now }))
    expect(validators.vehicle(record('vehicle', { status: 'retired' }))).toBe(false)
    expectValid('vehicle', record('vehicle', { status: 'retired', retiredAt: now }))
  })

  it('only accepts the declared statuses and types', () => {
    expect(validators.vehicle(record('vehicle', { status: 'sold' }))).toBe(false)
    expect(validators.contract(record('contract', { type: 'rental' }))).toBe(false)
    expect(validators.contract(record('contract', { status: 'draft' }))).toBe(false)
    expect(validators.service(record('service', { status: 'posted' }))).toBe(false)
  })

  it('rejects unknown fields, bad years and non-UTC instants', () => {
    expect(validators.vehicle(record('vehicle', { colour: 'red' }))).toBe(false)
    expect(validators.vehicle(record('vehicle', { year: '20x4' }))).toBe(false)
    expectValid('vehicle', record('vehicle', { year: '2024' }))
    expect(validators.service(record('service', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
