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

describe('Sales file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('keeps quoted amounts as exact decimal strings', () => {
    const lines = [{ product: '/products/PROD-0001', description: 'Chair', quantity: '2', unitPrice: '499.99', discount: '10' }]
    expectValid('quotation', record('quotation', { lines }))
    expect(validators.quotation(record('quotation', { lines: [{ ...lines[0], unitPrice: 499.99 }] }))).toBe(false)
    expect(validators.quotation(record('quotation', { lines: [{ ...lines[0], unitPrice: '-5' }] }))).toBe(false)
  })

  it('requires the confirmation trail once confirmed', () => {
    const totals = { subtotal: '100.00', discount: '10.00', total: '90.00' }
    expect(validators.quotation(record('quotation', { status: 'confirmed', confirmedAt: now }))).toBe(false)
    expectValid('quotation', record('quotation', { status: 'confirmed', confirmedAt: now, totals, order: { path: '/sales-orders/X-0001' } }))
    expectValid('quotation', record('quotation', { status: 'cancelled' }))
  })

  it('tracks delivery on sales orders', () => {
    expectValid('order', record('order', { deliveryStatus: 'delivered' }))
    expect(validators.order(record('order', { deliveryStatus: 'shipped' }))).toBe(false)
  })
})
