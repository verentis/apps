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

describe('Knowledge file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.some(starter => starter.kind === 'space')).toBe(true)
    const articles = starterRecords.filter(starter => starter.kind === 'article')
    expect(articles.length).toBeGreaterThanOrEqual(2)
    // One starter article nests beneath another so the hierarchy shows out of the box.
    expect(articles.some(article => articles.some(parent => parent !== article && article.parent?.endsWith(`/${parent.code}`)))).toBe(true)
  })

  it('starts new articles as drafts with an empty Markdown body', () => {
    expect(templates.article.status).toBe('draft')
    expect(templates.article.body).toBe('')
    expect(templates.article).not.toHaveProperty('publishedAt')
  })

  it('requires the publish stamp once published and keeps it through archive and restore', () => {
    expect(validators.article(record('article', { status: 'published' }))).toBe(false)
    expectValid('article', record('article', { status: 'published', publishedAt: now }))
    expectValid('article', record('article', { status: 'archived', publishedAt: now }))
    expectValid('article', record('article', { status: 'draft', publishedAt: now }))
  })

  it('rejects unknown statuses and non-string tags', () => {
    expect(validators.article(record('article', { status: 'live' }))).toBe(false)
    expect(validators.article(record('article', { tags: [1] }))).toBe(false)
    expectValid('article', record('article', { tags: ['handbook', 'policy'] }))
  })

  it('keeps references as workspace paths that may be empty', () => {
    expectValid('article', record('article', { space: '/knowledge-spaces/KS-0001', parent: '/articles/KA-0001' }))
    expect(validators.article(record('article', { parent: 'KA-0001' }))).toBe(false)
  })
})
