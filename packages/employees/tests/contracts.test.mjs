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

describe('Employees file contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and starter records', () => {
    expectValid('settings', defaultSettings)
    for (const starter of starterRecords) expectValid(starter.kind, starter)
    expect(starterRecords.some(starter => starter.kind === 'department')).toBe(true)
    expect(starterRecords.filter(starter => starter.kind === 'employee').length).toBeGreaterThanOrEqual(2)
  })

  it('requires the termination trail once terminated', () => {
    expect(validators.employee(record('employee', { status: 'terminated' }))).toBe(false)
    expect(validators.employee(record('employee', { status: 'terminated', terminationDate: '2026-02-01' }))).toBe(false)
    expectValid('employee', record('employee', { status: 'terminated', terminationDate: '2026-02-01', terminatedAt: now }))
    expectValid('employee', record('employee', { status: 'on-leave' }))
  })

  it('rejects unknown statuses and malformed contact details', () => {
    expect(validators.employee(record('employee', { status: 'retired' }))).toBe(false)
    expect(validators.employee(record('employee', { workEmail: 'not-an-email' }))).toBe(false)
    expect(validators.employee(record('employee', { startDate: '01/02/2026' }))).toBe(false)
    expectValid('employee', record('employee', { workEmail: 'a@b.co', startDate: '2026-02-01' }))
  })

  it('keeps department and manager references workspace paths', () => {
    expect(validators.employee(record('employee', { department: 'DEP-0001' }))).toBe(false)
    expectValid('employee', record('employee', { department: '/departments/DEP-0001', manager: '/employees/EMP-0001' }))
    expect(validators.department(record('department', { manager: 'EMP-0001' }))).toBe(false)
    expectValid('department', record('department', { manager: '/employees/EMP-0001' }))
  })
})
