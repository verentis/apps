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

describe('Manufacturing file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('keeps quantities as exact decimal strings', () => {
    expectValid('order', record('order', { quantity: '12.5' }))
    expect(validators.order(record('order', { quantity: 12.5 }))).toBe(false)
    expect(validators.order(record('order', { quantity: '-1' }))).toBe(false)
    expect(validators.bom(record('bom', { outputQty: 2 }))).toBe(false)
    expect(validators.bom(record('bom', { components: [{ product: '/products/P', name: '', quantity: 3 }] }))).toBe(false)
    expectValid('bom', record('bom', { routing: [{ operation: 'Assemble', workcenter: 'Bench 1', minutes: '30' }] }))
    expect(validators.bom(record('bom', { routing: [{ operation: 'Assemble', workcenter: '', minutes: 30 }] }))).toBe(false)
  })

  it('requires the audit trail as an order moves forward', () => {
    expect(validators.order(record('order', { status: 'confirmed' }))).toBe(false)
    expectValid('order', record('order', { status: 'confirmed', confirmedAt: now, product: '/products/P', productName: 'Desk' }))
    expect(validators.order(record('order', { status: 'in-progress', confirmedAt: now, product: '/products/P', productName: 'Desk' }))).toBe(false)
    expectValid('order', record('order', { status: 'in-progress', confirmedAt: now, startedAt: now, product: '/products/P', productName: 'Desk' }))
    expect(validators.order(record('order', { status: 'done', confirmedAt: now, startedAt: now, product: '/products/P', productName: 'Desk' }))).toBe(false)
    expectValid('order', record('order', {
      status: 'done', confirmedAt: now, startedAt: now, completedAt: now, product: '/products/P', productName: 'Desk',
      demand: [{ product: '/products/C', name: 'Leg', quantity: '4' }], moves: [{ path: '/stock-moves/MO-0001-OUT' }],
    }))
    expect(validators.order(record('order', { status: 'cancelled' }))).toBe(false)
    expectValid('order', record('order', { status: 'cancelled', cancelledAt: now }))
  })

  it('rejects unknown fields, unknown statuses and non-UTC instants', () => {
    expect(validators.order(record('order', { routing: [] }))).toBe(false)
    expect(validators.order(record('order', { status: 'paused' }))).toBe(false)
    expect(validators.bom(record('bom', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
