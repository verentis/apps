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

describe('Purchase file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('keeps ordered amounts as exact decimal strings', () => {
    const lines = [{ description: 'Widgets', quantity: '2.5', unitPrice: '120.00' }]
    expectValid('order', record('order', { lines }))
    expect(validators.order(record('order', { lines: [{ ...lines[0], unitPrice: 120 }] }))).toBe(false)
    expect(validators.order(record('order', { total: '-5' }))).toBe(false)
  })

  it('requires the confirmation trail once confirmed, received or cancelled', () => {
    const confirmed = { status: 'confirmed', confirmedAt: now, total: '300.00', vendorName: 'Initech' }
    expect(validators.order(record('order', { status: 'confirmed' }))).toBe(false)
    expectValid('order', record('order', confirmed))
    expect(validators.order(record('order', { ...confirmed, status: 'received' }))).toBe(false)
    expectValid('order', record('order', { ...confirmed, status: 'received', receivedAt: now, bill: { path: '/invoices/X-0001-BILL' } }))
    expect(validators.order(record('order', { status: 'cancelled' }))).toBe(false)
    expectValid('order', record('order', { status: 'cancelled', cancelledAt: now }))
  })

  it('rejects unknown fields and invalid vendor references', () => {
    expect(validators.vendor(record('vendor', { unknown: true }))).toBe(false)
    expect(validators.order(record('order', { vendor: 'not-a-path' }))).toBe(false)
  })
})
