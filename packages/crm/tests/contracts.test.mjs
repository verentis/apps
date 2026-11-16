import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { allKinds, defaultSettings, fillTemplate, schemas, templates } from '../src/contracts.mjs'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, ajv.compile(schema)]))
const id = '0b6f4c1e-8a7d-4f2b-9c3e-5d6a7b8c9d0e'
const now = '2026-01-02T03:04:05.678Z'

// Records get their code from the create script (`scripts/create/propose.mjs`).
function withCode(value) {
  return 'code' in value ? { ...value, code: value.code || 'X-0001' } : value
}

function record(kind, values = {}) {
  return { ...withCode(JSON.parse(fillTemplate(readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8'), { id, now, name: 'Example' }))), ...values }
}

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('CRM file contracts', () => {
  it.each(allKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(record(kind).id).toBe(id)
  })

  it('JSON-escapes substituted names', () => {
    expectValid('company', withCode(JSON.parse(fillTemplate(JSON.stringify(templates.company, null, 2), { id, now, name: 'Acme "Quoted" \\ Ltd' }))))
  })

  it('requires a generated code on records', () => {
    expect(validators.company(record('company', { code: '' }))).toBe(false)
    expect(validators.company(record('company', { code: '../x' }))).toBe(false)
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('references other records by absolute workspace path', () => {
    const customer = { path: '/customers/CUST-0001' }
    expectValid('contact', record('contact', { company: customer }))
    expectValid('deal', record('deal', { customer: { ...customer, nodeId: id } }))
    expect(validators.deal(record('deal', { customer: { app: 'crm', kind: 'company', id } }))).toBe(false)
    expect(validators.deal(record('deal', { customer: { path: 'customers/x.json' } }))).toBe(false)
    expectValid('email', record('email', { regarding: customer }))
  })

  it('requires archivedAt for archived records and completedAt for completed activities', () => {
    expect(validators.company(record('company', { state: 'archived' }))).toBe(false)
    expectValid('company', record('company', { state: 'archived', archivedAt: now }))
    expect(validators.task(record('task', { status: 'completed' }))).toBe(false)
    expectValid('task', record('task', { status: 'completed', completedAt: now }))
    expect(validators.case(record('case', { status: 'resolved' }))).toBe(false)
    expectValid('case', record('case', { status: 'closed', resolvedAt: now }))
  })

  it('stores deal amounts as decimals and date-times as local wall-clock values', () => {
    expectValid('deal', record('deal', { amount: 1234.5, currency: 'ZAR' }))
    expect(validators.deal(record('deal', { amount: '1234.50' }))).toBe(false)
    expectValid('meeting', record('meeting', { startsAt: '2026-01-02T09:30', endsAt: '' }))
    expect(validators.meeting(record('meeting', { startsAt: 'tomorrow' }))).toBe(false)
  })

  it('rejects unknown fields, business-store fields and non-UTC instants', () => {
    expect(validators.note(record('note', { workspaceId: 'workspace' }))).toBe(false)
    expect(validators.note(record('note', { surprise: true }))).toBe(false)
    expect(validators.note(record('note', { updatedAt: '2026-01-02T03:04:05+01:00' }))).toBe(false)
    expect(validators.note(record('note', { id: 'not-a-uuid' }))).toBe(false)
  })
})
