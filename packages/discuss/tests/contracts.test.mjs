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

const message = (sequence = 1, values = {}) => ({ sequence, author: 'Avery', date: now, body: 'Hello **there**', edited: false, ...values })

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('Discuss file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.map(starter => starter.kind)).toEqual(['channel', 'thread'])
    expect(starterRecords[1].messages).toHaveLength(1)
  })

  it('keeps the message trail well-formed', () => {
    expectValid('thread', record('thread', { messages: [message(1), message(2, { key: 'retry-1' })], lastActivityAt: now }))
    expect(validators.thread(record('thread', { messages: [message(1, { body: '' })] }))).toBe(false)
    expect(validators.thread(record('thread', { messages: [message(0)] }))).toBe(false)
    expect(validators.thread(record('thread', { messages: [{ sequence: 1, author: 'A', date: now, body: 'x' }] }))).toBe(false)
    expect(validators.thread(record('thread', { messages: [message(1, { extra: true })] }))).toBe(false)
  })

  it('requires the transition stamps once resolved or locked', () => {
    expect(validators.thread(record('thread', { status: 'resolved' }))).toBe(false)
    expectValid('thread', record('thread', { status: 'resolved', resolvedAt: now }))
    expect(validators.thread(record('thread', { status: 'locked', resolvedAt: now }))).toBe(false)
    expectValid('thread', record('thread', { status: 'locked', resolvedAt: now, lockedAt: now }))
  })

  it('bounds the channel kind and status to their enums', () => {
    expect(validators.channel(record('channel', { visibility: 'secret' }))).toBe(false)
    expect(validators.channel(record('channel', { status: 'closed' }))).toBe(false)
    expectValid('channel', record('channel', { visibility: 'private', status: 'archived' }))
  })

  it('keeps lastActivityAt an empty or UTC timestamp', () => {
    expectValid('thread', record('thread', { lastActivityAt: '' }))
    expectValid('thread', record('thread', { lastActivityAt: '2026-01-03T03:04:05Z' }))
    expect(validators.thread(record('thread', { lastActivityAt: '2026-01-03T03:04:05+02:00' }))).toBe(false)
  })
})
