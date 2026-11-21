import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, recordKinds, schemas, starterRecords, statuses, templates } from '../src/contracts.mjs'

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

describe('Documents file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('starts new document cards in the inbox without a validation stamp', () => {
    expect(templates.document.status).toBe('inbox')
    expect(templates.document.filePath).toBe('')
    expect(templates.document).not.toHaveProperty('validatedAt')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.filter(starter => starter.kind === 'workspace')).toHaveLength(2)
    expect(starterRecords.filter(starter => starter.kind === 'tag').length).toBeGreaterThanOrEqual(3)
    expect(starterRecords.filter(starter => starter.kind === 'document').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the file path a workspace path reference, never content', () => {
    expectValid('document', record('document', { filePath: '' }))
    expectValid('document', record('document', { filePath: '/shared/contracts/example.pdf' }))
    expect(validators.document(record('document', { filePath: 'not-a-path' }))).toBe(false)
    expect(schemas.document.properties).not.toHaveProperty('content')
    expect(schemas.document.properties).not.toHaveProperty('data')
  })

  it('requires the validation stamp once validated or archived', () => {
    expect(statuses).toEqual(['inbox', 'in-review', 'validated', 'archived-status'])
    expect(validators.document(record('document', { status: 'validated' }))).toBe(false)
    expectValid('document', record('document', { status: 'validated', validatedAt: now }))
    expect(validators.document(record('document', { status: 'archived-status' }))).toBe(false)
    expectValid('document', record('document', { status: 'archived-status', validatedAt: now }))
    expect(validators.document(record('document', { status: 'done' }))).toBe(false)
  })

  it('bounds a workspace\'s default tags and a card\'s tags', () => {
    expectValid('workspace', record('workspace', { defaultTags: ['finance', 'invoice'] }))
    expect(validators.workspace(record('workspace', { defaultTags: ['x'.repeat(101)] }))).toBe(false)
    expect(validators.document(record('document', { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }))).toBe(false)
  })
})
