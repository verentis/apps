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

const aQuestion = (values = {}) => ({ sequence: 1, text: 'How was it?', kind: 'text', choices: [], required: false, ...values })
const anAnswer = (values = {}) => ({ sequence: 1, value: 'Great', values: [], ...values })

function expectValid(kind, value) {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('Surveys file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings', () => {
    expectValid('settings', defaultSettings)
  })

  it('requires the lifecycle stamps per survey status', () => {
    expect(validators.survey(record('survey', { status: 'open' }))).toBe(false)
    expectValid('survey', record('survey', { status: 'open', openedAt: now }))
    expect(validators.survey(record('survey', { status: 'closed', openedAt: now }))).toBe(false)
    expectValid('survey', record('survey', { status: 'closed', openedAt: now, closedAt: now }))
  })

  it('requires the submission stamp once submitted', () => {
    expect(validators.response(record('response', { status: 'submitted' }))).toBe(false)
    expectValid('response', record('response', { status: 'submitted', submittedAt: now }))
  })

  it('validates questions', () => {
    expectValid('survey', record('survey', { questions: [aQuestion(), aQuestion({ sequence: 2, kind: 'single-choice', choices: ['Yes', 'No'], required: true })] }))
    expect(validators.survey(record('survey', { questions: [aQuestion({ sequence: 0 })] }))).toBe(false)
    expect(validators.survey(record('survey', { questions: [aQuestion({ sequence: 1.5 })] }))).toBe(false)
    expect(validators.survey(record('survey', { questions: [aQuestion({ sequence: 1000 })] }))).toBe(false)
    expect(validators.survey(record('survey', { questions: [aQuestion({ kind: 'essay' })] }))).toBe(false)
    expect(validators.survey(record('survey', { questions: [aQuestion({ required: 'yes' })] }))).toBe(false)
    expect(validators.survey(record('survey', { questions: [{ sequence: 1, text: 'No kind' }] }))).toBe(false)
  })

  it('validates answers', () => {
    expectValid('response', record('response', { answers: [anAnswer(), anAnswer({ sequence: 2, value: '', values: ['A', 'B'] })] }))
    expectValid('response', record('response', { answers: [{ sequence: 3 }] }))
    expect(validators.response(record('response', { answers: [anAnswer({ sequence: '1' })] }))).toBe(false)
    expect(validators.response(record('response', { answers: [{ value: 'orphan' }] }))).toBe(false)
    expect(validators.response(record('response', { answers: [anAnswer({ values: 'A' })] }))).toBe(false)
  })

  it('keeps the survey reference a path or empty', () => {
    expectValid('response', record('response', { survey: '/surveys/SUR-0001' }))
    expectValid('response', record('response', { survey: '' }))
    expect(validators.response(record('response', { survey: 'SUR-0001' }))).toBe(false)
  })
})
