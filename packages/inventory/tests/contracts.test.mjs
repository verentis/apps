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

describe('Inventory file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
  })

  it('keeps quantities as exact decimal strings', () => {
    expectValid('move', record('move', { quantity: '12.5' }))
    expect(validators.move(record('move', { quantity: 12.5 }))).toBe(false)
    expect(validators.move(record('move', { quantity: '-1' }))).toBe(false)
    expect(validators.move(record('move', { quantity: '1.23456' }))).toBe(false)
    expect(validators.adjustment(record('adjustment', { countedQty: 3 }))).toBe(false)
  })

  it('requires the audit trail once done or applied', () => {
    expect(validators.move(record('move', { status: 'done' }))).toBe(false)
    expectValid('move', record('move', { status: 'done', postedAt: now }))
    expect(validators.adjustment(record('adjustment', { status: 'applied' }))).toBe(false)
    expectValid('adjustment', record('adjustment', { status: 'applied', appliedAt: now, move: { path: '/stock-moves/ADJ-0001' } }))
  })

  it('rejects unknown fields and non-UTC instants', () => {
    expect(validators.move(record('move', { onHand: '1' }))).toBe(false)
    expect(validators.move(record('move', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })

  it('rejects empty warehouse location names', () => {
    expectValid('warehouse', record('warehouse', { locations: ['Stock', 'Input'] }))
    expect(validators.warehouse(record('warehouse', { locations: [''] }))).toBe(false)
  })
})
