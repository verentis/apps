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

describe('Invoicing file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('keeps billed amounts as exact decimal strings', () => {
    const lines = [{ description: 'Consulting', quantity: '1.5', unitPrice: '1200.00', taxRate: '15' }]
    expectValid('invoice', record('invoice', { lines }))
    expect(validators.invoice(record('invoice', { lines: [{ ...lines[0], unitPrice: 1200 }] }))).toBe(false)
    expect(validators.payment(record('payment', { amount: '-5' }))).toBe(false)
  })

  it('requires the issue trail once issued or posted', () => {
    const issued = { status: 'issued', issuedAt: now, totals: { net: '1.00', tax: '0.15', gross: '1.15' }, journal: { path: '/journals/INV-0001' }, document: { path: '/invoices/INV-0001/documents/INV-0001.md' } }
    expect(validators.invoice(record('invoice', { status: 'issued', issuedAt: now }))).toBe(false)
    expectValid('invoice', record('invoice', { ...issued, seller: { name: 'Us' } }))
    expect(validators.credit(record('credit', issued))).toBe(false)
    expectValid('credit', record('credit', { ...issued, customer: { name: 'Them' } }))
    expect(validators.payment(record('payment', { status: 'posted' }))).toBe(false)
    expect(validators.payment(record('payment', { status: 'reversed', postedAt: now, journal: { path: '/journals/PAY-0001' } }))).toBe(false)
  })
})
