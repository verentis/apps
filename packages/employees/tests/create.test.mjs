import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecord } from '../scripts/create/main.mjs'
import { defaultSettings } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

const workspace = (extra = {}) => memoryFiles({ '/settings/employees.json': defaultSettings, ...extra })

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.employees.${kind}+json`,
  parentPath: kind === 'employee' ? '/employees' : '/departments', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Employees create script', () => {
  it('creates an employee with the default department and today as the start date', async () => {
    const files = workspace()
    const result = await createRecord(input('employee'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/employees/EMP-0001' })
    expect(files.json('/employees/EMP-0001')).toMatchObject({
      kind: 'employee', code: 'EMP-0001', name: 'Example', status: 'active',
      department: '/departments/DEP-0001', startDate: '2026-03-10',
    })
  })

  it('leaves the department empty when the settings are unreadable', async () => {
    const files = memoryFiles({})
    await createRecord(input('employee'), undefined, files, { uuid })
    expect(files.json('/employees/EMP-0001').department).toBe('')
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('employee'), undefined, files, { uuid })
    const result = await createRecord(input('employee'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/employees/EMP-0002' })
  })

  it('creates a department without defaults', async () => {
    const files = workspace()
    const result = await createRecord(input('department'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/departments/DEP-0001' })
    expect(files.json('/departments/DEP-0001')).toMatchObject({ kind: 'department', name: 'Example', manager: '' })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('employee', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('EMP-0001')
    expect(proposal.content.department).toBe('/departments/DEP-0001')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('employee', { creatable: 'contractor' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Employees record type/)
  })
})
