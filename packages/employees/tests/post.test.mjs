import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const employee = (values = {}) => ({
  ...templates.employee, id: uuid(), createdAt: now, updatedAt: now, code: 'EMP-0001',
  name: 'Avery Adams', jobTitle: 'Operations manager', department: '/departments/DEP-0001',
  startDate: '2024-01-15', status: 'active', ...values,
})
const call = (files, operation, path = '/employees/EMP-0001', extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Employees terminate action', () => {
  it('terminates an active employee with the given date, idempotently', async () => {
    const files = memoryFiles({ '/employees/EMP-0001': employee() })
    expect(await call(files, 'terminate', '/employees/EMP-0001', { date: '2026-03-31' }))
      .toEqual({ message: 'Terminated EMP-0001 as of 2026-03-31', path: '/employees/EMP-0001' })
    expect(files.json('/employees/EMP-0001')).toMatchObject({
      status: 'terminated', terminationDate: '2026-03-31', terminatedAt: now, updatedAt: now,
    })
    expect(await call(files, 'terminate')).toMatchObject({ message: 'EMP-0001 is already terminated (2026-03-31)' })
    expect(files.writes).toHaveLength(1)
  })

  it('defaults the termination date to today', async () => {
    const files = memoryFiles({ '/employees/EMP-0001': employee() })
    await call(files, 'terminate')
    expect(files.json('/employees/EMP-0001').terminationDate).toBe('2026-03-10')
  })

  it('refuses to terminate an on-leave employee', async () => {
    const files = memoryFiles({ '/employees/EMP-0001': employee({ status: 'on-leave' }) })
    await expect(call(files, 'terminate')).rejects.toThrow(/only active employees can be terminated/)
    expect(files.json('/employees/EMP-0001').status).toBe('on-leave')
  })

  it('refuses invalid dates and dates before the start date', async () => {
    const files = memoryFiles({ '/employees/EMP-0001': employee() })
    await expect(call(files, 'terminate', '/employees/EMP-0001', { date: 'soon' })).rejects.toThrow(/not a valid termination date/)
    await expect(call(files, 'terminate', '/employees/EMP-0001', { date: '2023-12-31' })).rejects.toThrow(/before the start date/)
    expect(files.json('/employees/EMP-0001').status).toBe('active')
  })

  it('refuses archived employees and anything that is not an employee in /employees', async () => {
    const files = memoryFiles({
      '/employees/EMP-0001': employee({ state: 'archived', archivedAt: now }),
      '/employees/odd': { kind: 'department', name: 'Not an employee' },
    })
    await expect(call(files, 'terminate')).rejects.toThrow(/is archived/)
    await expect(call(files, 'terminate', '/employees/odd')).rejects.toThrow(/is not an employee/)
    await expect(call(files, 'terminate', '/employees/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'terminate', '/departments/DEP-0001')).rejects.toThrow(/directly in \/employees/)
    await expect(call(files, 'promote')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/employees/EMP-0001': employee() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'terminate')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/employees/EMP-0001').status).toBe('active')
  })
})
