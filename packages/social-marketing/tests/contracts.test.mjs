import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, networks, recordKinds, schemas, templates } from '../src/contracts.mjs'

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

describe('Social Marketing file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
    expect(validators.settings({ ...defaultSettings, defaultAccount: 'not-a-path' })).toBe(false)
  })

  it('keeps accounts to the known networks with a boolean active switch', () => {
    for (const network of networks) expectValid('account', record('account', { network }))
    expect(validators.account(record('account', { network: 'myspace' }))).toBe(false)
    expect(validators.account(record('account', { active: 'yes' }))).toBe(false)
  })

  it('requires the publish stamp once published and the cancel stamp once cancelled', () => {
    expect(validators.post(record('post', { status: 'published' }))).toBe(false)
    expectValid('post', record('post', { status: 'published', publishedAt: now }))
    expect(validators.post(record('post', { status: 'cancelled' }))).toBe(false)
    expectValid('post', record('post', { status: 'cancelled', cancelledAt: now }))
    expect(validators.post(record('post', { status: 'live' }))).toBe(false)
  })

  it('keeps engagement whole non-negative counts', () => {
    expectValid('post', record('post', { engagement: { likes: 3, shares: 0, comments: 12 } }))
    expect(validators.post(record('post', { engagement: { likes: -1, shares: 0, comments: 0 } }))).toBe(false)
    expect(validators.post(record('post', { engagement: { likes: 1.5, shares: 0, comments: 0 } }))).toBe(false)
    expect(validators.post(record('post', { engagement: { likes: 0, shares: 0 } }))).toBe(false)
    const { engagement, ...missing } = record('post')
    expect(validators.post(missing)).toBe(false)
  })

  it('keeps the scheduled date an empty or calendar date', () => {
    expectValid('post', record('post', { scheduledDate: '' }))
    expectValid('post', record('post', { scheduledDate: '2026-02-03' }))
    expect(validators.post(record('post', { scheduledDate: '2026-02-03T00:00:00Z' }))).toBe(false)
  })
})
