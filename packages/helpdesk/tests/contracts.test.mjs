import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, starterRecords, templates } from '../src/contracts.mjs'

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

describe('Helpdesk file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.some(starter => starter.kind === 'team')).toBe(true)
    expect(starterRecords.filter(starter => starter.kind === 'ticket').length).toBeGreaterThanOrEqual(2)
  })

  it('requires the resolution trail once solved and the close stamp once closed', () => {
    expect(validators.ticket(record('ticket', { stage: 'solved' }))).toBe(false)
    expectValid('ticket', record('ticket', { stage: 'solved', resolution: 'Fixed', resolvedAt: now }))
    expect(validators.ticket(record('ticket', { stage: 'closed', resolution: 'Fixed', resolvedAt: now }))).toBe(false)
    expectValid('ticket', record('ticket', { stage: 'closed', resolution: 'Fixed', resolvedAt: now, closedAt: now }))
  })

  it('keeps the SLA deadline an empty or UTC timestamp', () => {
    expectValid('ticket', record('ticket', { slaDeadline: '' }))
    expectValid('ticket', record('ticket', { slaDeadline: '2026-01-03T03:04:05Z' }))
    expect(validators.ticket(record('ticket', { slaDeadline: '2026-01-03' }))).toBe(false)
    expect(validators.ticket(record('ticket', { slaDeadline: '2026-01-03T03:04:05+02:00' }))).toBe(false)
  })

  it('bounds a team\'s SLA hours to whole hours', () => {
    expect(validators.team(record('team', { slaHours: 0 }))).toBe(false)
    expect(validators.team(record('team', { slaHours: 1.5 }))).toBe(false)
    expectValid('team', record('team', { slaHours: 72 }))
  })
})
