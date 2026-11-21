import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { templates as projectTemplates } from '../../project/src/contracts.mjs'
import { checkHours, operations, run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now }
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const record = (kind, values = {}, source = templates) => ({ ...source[kind], id: uuid(), createdAt: now, updatedAt: now, ...values })
const entry = (values = {}) => record('entry', {
  code: 'TS-0001', employee: 'Thandi', date: '2026-03-09', hours: '7.5',
  project: '/projects/PROJ-0001', task: '/tasks/TASK-0001', ...values,
})
// Entries reference Project records (optional dependency) when that app is present.
const workspace = (values = {}) => memoryFiles({
  '/projects/PROJ-0001': record('project', { code: 'PROJ-0001', name: 'Apollo' }, projectTemplates),
  '/tasks/TASK-0001': record('task', { code: 'TASK-0001', title: 'Wire the auth flow', project: '/projects/PROJ-0001' }, projectTemplates),
  '/timesheets/TS-0001': entry(values),
})
const call = (files, operation, path) => run({ operation, path }, files, options)

describe('Timesheets hours check', () => {
  it.each(['7.5', '0.25', '8'])('accepts %s', hours => expect(checkHours(hours, {})).toBe(hours))
  it.each(['0', '0.000', '', '  ', '-1', '1,5', 'eight', 7.5])('rejects %j', hours =>
    expect(() => checkHours(hours, {})).toThrow(/positive decimal|zero hours/))
})

describe('Timesheets validate-entry script', () => {
  it('validates a draft entry that references Project records and stamps when', async () => {
    const files = workspace()
    expect(await call(files, 'validate-entry', '/timesheets/TS-0001')).toEqual({ message: 'TS-0001 is validated', path: '/timesheets/TS-0001' })
    expect(files.json('/timesheets/TS-0001')).toMatchObject({ status: 'validated', validatedAt: now, updatedAt: now, hours: '7.5' })
  })

  it('also validates entries without Project references (the dependency is optional)', async () => {
    const files = memoryFiles({ '/timesheets/TS-0001': entry({ project: '', task: '' }) })
    await call(files, 'validate-entry', '/timesheets/TS-0001')
    expect(files.json('/timesheets/TS-0001').status).toBe('validated')
  })

  it('is idempotent: an already-validated entry keeps its validation time', async () => {
    const files = workspace({ status: 'validated', validatedAt: '2026-03-01T00:00:00Z' })
    expect(await call(files, 'validate-entry', '/timesheets/TS-0001')).toMatchObject({ message: 'TS-0001 is already validated' })
    expect(files.json('/timesheets/TS-0001').validatedAt).toBe('2026-03-01T00:00:00Z')
    expect(files.writes).toEqual([])
  })

  it.each([
    ['zero hours', { hours: '0' }, /zero hours/],
    ['malformed hours', { hours: 'eight' }, /positive decimal/],
    ['a missing date', { date: '' }, /needs a date/],
    ['a missing employee', { employee: ' ' }, /employee name/],
    ['an archived entry', { state: 'archived', archivedAt: now }, /archived/],
    ['an unexpected status', { status: 'approved' }, /unexpected status "approved"/],
  ])('refuses to validate %s', async (_, values, error) => {
    const files = workspace(values)
    await expect(call(files, 'validate-entry', '/timesheets/TS-0001')).rejects.toThrow(error)
    expect(files.json('/timesheets/TS-0001').status).not.toBe('validated')
  })

  it('refuses paths outside /timesheets, missing files and non-entries', async () => {
    const files = workspace()
    await expect(call(files, 'validate-entry', '/projects/PROJ-0001')).rejects.toThrow(/directly in \/timesheets/)
    await expect(call(files, 'validate-entry', '/timesheets/a/TS-0001')).rejects.toThrow(/directly in \/timesheets/)
    await expect(call(files, 'validate-entry', '/timesheets/TS-0009')).rejects.toThrow(/does not exist/)
    files.nodes.set('/timesheets/PROJ', files.nodes.get('/projects/PROJ-0001'))
    await expect(call(files, 'validate-entry', '/timesheets/PROJ')).rejects.toThrow(/is not a timesheet entry/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => {
      files.write = write
      files.touch(path)
      return write(path, content, options)
    }
    await expect(call(files, 'validate-entry', '/timesheets/TS-0001')).rejects.toThrow(/changed while it was being validated/)
    expect(files.json('/timesheets/TS-0001').status).toBe('draft')
  })

  it('rejects unknown operations', async () => {
    await expect(run({ operation: 'approve-entry', path: '/timesheets/TS-0001' }, memoryFiles(), options))
      .rejects.toThrow(`Unsupported operation "approve-entry". Expected one of ${operations.join(', ')}.`)
  })
})
