import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, starterAccounts, templates } from '../src/contracts.mjs'

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

describe('Accounting file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter chart of accounts', () => {
    expectValid('settings', defaultSettings)
    for (const account of starterAccounts) expectValid('account', account)
  })

  it('keeps money as exact decimal strings', () => {
    expectValid('expense', record('expense', { netAmount: '1250.50', taxAmount: '187.58' }))
    expect(validators.expense(record('expense', { netAmount: 1250.5 }))).toBe(false)
    expect(validators.expense(record('expense', { netAmount: '-1' }))).toBe(false)
    expect(validators.expense(record('expense', { netAmount: '1.23456' }))).toBe(false)
  })

  it('requires the posting trail once posted', () => {
    const posted = { status: 'posted', postedAt: now }
    expect(validators.journal(record('journal', posted))).toBe(false)
    expectValid('journal', record('journal', { ...posted, period: { path: '/periods/PER-0001' } }))
    expect(validators.expense(record('expense', { status: 'posted', postedAt: now }))).toBe(false)
    expectValid('expense', record('expense', { status: 'posted', postedAt: now, grossAmount: '10.00', journal: { path: '/journals/EXP-0001' } }))
    expect(validators.period(record('period', { status: 'closed', closedAt: now }))).toBe(false)
    expectValid('period', record('period', { status: 'closed', closedAt: now, startDate: '2026-01-01', endDate: '2026-01-31' }))
  })

  it('rejects unknown fields and non-UTC instants', () => {
    expect(validators.account(record('account', { balance: '1' }))).toBe(false)
    expect(validators.account(record('account', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
  })
})
