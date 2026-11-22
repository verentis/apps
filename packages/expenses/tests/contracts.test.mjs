import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, sampleReport, schemas, starterCategories, templates } from '../src/contracts.mjs'

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

describe('Expenses file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings, starter categories and sample report', () => {
    expectValid('settings', defaultSettings)
    for (const category of starterCategories) expectValid('category', category)
    expectValid('report', sampleReport)
    expect(sampleReport.status).toBe('draft')
    expect(starterCategories.map(category => category.code)).toContain(sampleReport.lines[0].category.split('/').pop())
  })

  it('keeps expensed amounts as exact decimal strings', () => {
    const lines = [{ category: '/expense-categories/CAT-0001', description: 'Taxi', amount: '125.50', date: '2026-01-02' }]
    expectValid('report', record('report', { lines }))
    expect(validators.report(record('report', { lines: [{ ...lines[0], amount: 125.5 }] }))).toBe(false)
    expect(validators.report(record('report', { lines: [{ ...lines[0], amount: '-5' }] }))).toBe(false)
  })

  it('requires the status trail as a report moves through its statuses', () => {
    const submitted = { status: 'submitted', submittedAt: now, total: '125.50' }
    const approved = { ...submitted, status: 'approved', approver: 'Fin Manager', approvedAt: now }
    expect(validators.report(record('report', { status: 'submitted' }))).toBe(false)
    expectValid('report', record('report', submitted))
    expect(validators.report(record('report', { ...submitted, status: 'approved' }))).toBe(false)
    expectValid('report', record('report', approved))
    expect(validators.report(record('report', { ...submitted, status: 'refused' }))).toBe(false)
    expectValid('report', record('report', { ...submitted, status: 'refused', refusalReason: 'No receipts', refusedAt: now }))
    expect(validators.report(record('report', { ...approved, status: 'posted' }))).toBe(false)
    expectValid('report', record('report', { ...approved, status: 'posted', postedAt: now, journal: { path: '/journals/EXP-0001' } }))
  })
})
