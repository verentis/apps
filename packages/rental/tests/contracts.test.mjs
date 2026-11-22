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

describe('Rental file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('keeps rates, deposits and fees as exact decimal strings and quantities as whole numbers', () => {
    expectValid('product', record('product', { dailyRate: '150.00', deposit: '500.00', quantityOwned: 10 }))
    expect(validators.product(record('product', { dailyRate: 150 }))).toBe(false)
    expect(validators.product(record('product', { dailyRate: '-5' }))).toBe(false)
    expect(validators.product(record('product', { quantityOwned: '10' }))).toBe(false)
    expect(validators.booking(record('booking', { quantity: 1.5 }))).toBe(false)
    expect(validators.settings({ ...defaultSettings, dailyLateRate: 10 })).toBe(false)
  })

  it('requires the lifecycle trail as a booking moves through its statuses', () => {
    const confirmed = { status: 'confirmed', confirmedAt: now, dailyRate: '100.00', total: '300.00' }
    expect(validators.booking(record('booking', { status: 'confirmed' }))).toBe(false)
    expectValid('booking', record('booking', confirmed))
    expect(validators.booking(record('booking', { ...confirmed, status: 'picked-up' }))).toBe(false)
    expectValid('booking', record('booking', { ...confirmed, status: 'picked-up', pickedUpAt: now }))
    expect(validators.booking(record('booking', { ...confirmed, status: 'returned', pickedUpAt: now }))).toBe(false)
    expectValid('booking', record('booking', { ...confirmed, status: 'returned', pickedUpAt: now, returnedAt: now, lateFee: '0.00', invoice: { path: '/invoices/X-0001' } }))
    expect(validators.booking(record('booking', { status: 'cancelled' }))).toBe(false)
    expectValid('booking', record('booking', { status: 'cancelled', cancelledAt: now }))
  })

  it('limits products to the available and unavailable statuses', () => {
    expectValid('product', record('product', { status: 'unavailable' }))
    expect(validators.product(record('product', { status: 'retired' }))).toBe(false)
  })
})
