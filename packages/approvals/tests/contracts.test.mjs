import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, sampleRequest, schemas, starterTypes, templates } from '../src/contracts.mjs'

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

describe('Approvals file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings, starter types and sample request', () => {
    expectValid('settings', defaultSettings)
    for (const type of starterTypes) expectValid('type', type)
    expectValid('request', sampleRequest)
    expect(sampleRequest.status).toBe('draft')
    expect(starterTypes.map(type => type.code)).toContain(sampleRequest.type.split('/').pop())
  })

  it('needs at least one distinct approver per type', () => {
    expect(validators.type(record('type', { requiredApprovers: 0 }))).toBe(false)
    expect(validators.type(record('type', { requiredApprovers: 1.5 }))).toBe(false)
    expectValid('type', record('type', { requiredApprovers: 3 }))
  })

  it('keeps request amounts as exact decimal strings', () => {
    expectValid('request', record('request', { amount: '1250.00' }))
    expect(validators.request(record('request', { amount: 1250 }))).toBe(false)
    expect(validators.request(record('request', { amount: '-5' }))).toBe(false)
  })

  it('accepts only well-formed approval entries', () => {
    const entry = { approver: 'Ana', date: now, decision: 'approve', comment: '' }
    const submitted = { status: 'submitted', submittedAt: now }
    expectValid('request', record('request', { ...submitted, approvals: [entry] }))
    expect(validators.request(record('request', { ...submitted, approvals: [{ ...entry, decision: 'maybe' }] }))).toBe(false)
    expect(validators.request(record('request', { ...submitted, approvals: [{ approver: 'Ana', decision: 'approve' }] }))).toBe(false)
  })

  it('requires the status trail as a request moves through its statuses', () => {
    const submitted = { status: 'submitted', submittedAt: now }
    expect(validators.request(record('request', { status: 'submitted' }))).toBe(false)
    expectValid('request', record('request', submitted))
    expect(validators.request(record('request', { ...submitted, status: 'approved' }))).toBe(false)
    expectValid('request', record('request', { ...submitted, status: 'approved', decidedAt: now }))
    expect(validators.request(record('request', { ...submitted, status: 'refused' }))).toBe(false)
    expectValid('request', record('request', { ...submitted, status: 'refused', decidedAt: now }))
    expect(validators.request(record('request', { status: 'cancelled' }))).toBe(false)
    expectValid('request', record('request', { status: 'cancelled', cancelledAt: now }))
  })
})
