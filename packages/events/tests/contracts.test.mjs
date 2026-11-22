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

describe('Events file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the lifecycle stamps per event status', () => {
    expect(validators.event(record('event', { status: 'published' }))).toBe(false)
    expectValid('event', record('event', { status: 'published', publishedAt: now }))
    expectValid('event', record('event', { status: 'ongoing', publishedAt: now }))
    expect(validators.event(record('event', { status: 'done', publishedAt: now }))).toBe(false)
    expectValid('event', record('event', { status: 'done', publishedAt: now, completedAt: now }))
    expect(validators.event(record('event', { status: 'cancelled' }))).toBe(false)
    expectValid('event', record('event', { status: 'cancelled', cancelledAt: now }))
  })

  it('requires the confirmation stamp once confirmed or attended', () => {
    expect(validators.registration(record('registration', { status: 'confirmed' }))).toBe(false)
    expectValid('registration', record('registration', { status: 'confirmed', confirmedAt: now }))
    expect(validators.registration(record('registration', { status: 'attended' }))).toBe(false)
    expectValid('registration', record('registration', { status: 'attended', confirmedAt: now }))
    expectValid('registration', record('registration', { status: 'cancelled' }))
  })

  it('keeps capacity and seats whole numbers and the ticket price a decimal string', () => {
    expect(validators.event(record('event', { capacity: -1 }))).toBe(false)
    expect(validators.event(record('event', { capacity: 2.5 }))).toBe(false)
    expectValid('event', record('event', { capacity: 0 }))
    expect(validators.event(record('event', { ticketPrice: 25 }))).toBe(false)
    expectValid('event', record('event', { ticketPrice: '25.00' }))
    expect(validators.registration(record('registration', { qty: 0 }))).toBe(false)
    expect(validators.registration(record('registration', { qty: '2' }))).toBe(false)
    expectValid('registration', record('registration', { qty: 2 }))
  })

  it('keeps the schedule empty or UTC timestamps', () => {
    expectValid('event', record('event', { startsAt: '', endsAt: '' }))
    expectValid('event', record('event', { startsAt: '2026-06-01T09:00:00Z' }))
    expect(validators.event(record('event', { startsAt: '2026-06-01' }))).toBe(false)
    expect(validators.event(record('event', { startsAt: '2026-06-01T09:00:00+02:00' }))).toBe(false)
  })
})
