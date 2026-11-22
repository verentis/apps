import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, seedRecords, templates } from '../src/contracts.mjs'

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

describe('Payroll file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and sample records', () => {
    expectValid('settings', defaultSettings)
    for (const { record: seeded } of seedRecords) expectValid(seeded.kind, seeded)
  })

  it('keeps wages, amounts and rates as exact decimal strings', () => {
    expectValid('profile', record('profile', { baseWage: '20000.00' }))
    expect(validators.profile(record('profile', { baseWage: 20000 }))).toBe(false)
    expect(validators.profile(record('profile', { baseWage: '-5' }))).toBe(false)
    const rules = [{ code: 'TAX', name: 'Tax', kind: 'deduction', computation: 'percent-of-base', amount: '', rate: '12.5', sequence: '20' }]
    expectValid('structure', record('structure', { rules }))
    expect(validators.structure(record('structure', { rules: [{ ...rules[0], rate: 12.5 }] }))).toBe(false)
    expect(validators.structure(record('structure', { rules: [{ ...rules[0], kind: 'tax-table' }] }))).toBe(false)
  })

  it('requires the computed and posted trail as a run advances', () => {
    const payslips = [{ employee: 'Alex', profile: '/pay-profiles/PAYEMP-0001', base: '100.00',
      lines: [{ rule: 'BASE', name: 'Base salary', kind: 'earning', amount: '100.00' }],
      gross: '100.00', deductions: '0.00', contributions: '0.00', net: '100.00' }]
    const totals = { gross: '100.00', deductions: '0.00', contributions: '0.00', net: '100.00' }
    const computed = { period: '2026-11', currency: 'ZAR', status: 'computed', computedAt: now, payslips, totals }
    expect(validators.payrun(record('payrun', { status: 'computed' }))).toBe(false)
    expectValid('payrun', record('payrun', computed))
    expect(validators.payrun(record('payrun', { ...computed, status: 'approved' }))).toBe(false)
    expectValid('payrun', record('payrun', { ...computed, status: 'approved', approvedAt: now }))
    expect(validators.payrun(record('payrun', { ...computed, status: 'posted', approvedAt: now, postedAt: now }))).toBe(false)
    expectValid('payrun', record('payrun', { ...computed, status: 'posted', approvedAt: now, postedAt: now, journal: { path: '/journals/PAYRUN-0001' } }))
    expect(validators.payrun(record('payrun', { period: '2026-13' }))).toBe(false)
  })
})
