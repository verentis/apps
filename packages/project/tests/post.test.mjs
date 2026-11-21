import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { completableStages, operations, run } from '../scripts/post/main.mjs'
import { memoryFiles, PreconditionFailed } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now }
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const record = (kind, values = {}) => ({ ...templates[kind], id: uuid(), createdAt: now, updatedAt: now, ...values })
const task = (values = {}) => record('task', {
  code: 'TASK-0001', title: 'Wire the auth flow', project: '/projects/PROJ-0001', stage: 'in-progress', ...values,
})
const call = (files, operation, path) => run({ operation, path }, files, options)

describe('Project complete-task script', () => {
  it.each(completableStages)('completes a task from %s and stamps when', async stage => {
    const files = memoryFiles({ '/tasks/TASK-0001': task({ stage }) })
    expect(await call(files, 'complete-task', '/tasks/TASK-0001')).toEqual({ message: 'TASK-0001 is done', path: '/tasks/TASK-0001' })
    expect(files.json('/tasks/TASK-0001')).toMatchObject({ stage: 'done', completedAt: now, updatedAt: now })
  })

  it('is idempotent: an already-done task keeps its completion time', async () => {
    const files = memoryFiles({ '/tasks/TASK-0001': task({ stage: 'done', completedAt: '2026-03-01T00:00:00Z' }) })
    expect(await call(files, 'complete-task', '/tasks/TASK-0001')).toMatchObject({ message: 'TASK-0001 is already done' })
    expect(files.json('/tasks/TASK-0001').completedAt).toBe('2026-03-01T00:00:00Z')
    expect(files.writes).toEqual([])
  })

  it.each([
    ['an invalid stage', task({ stage: 'cancelled' }), /cannot move from "cancelled" to done/],
    ['an archived task', task({ state: 'archived', archivedAt: now }), /archived/],
    ['a task without a title', task({ title: ' ' }), /needs a title/],
  ])('refuses %s', async (_, value, error) => {
    const files = memoryFiles({ '/tasks/TASK-0001': value })
    await expect(call(files, 'complete-task', '/tasks/TASK-0001')).rejects.toThrow(error)
    expect(files.json('/tasks/TASK-0001').stage).not.toBe('done')
  })

  it('refuses paths outside /tasks, missing files and non-tasks', async () => {
    const files = memoryFiles({ '/projects/PROJ-0001': record('project', { code: 'PROJ-0001', name: 'Apollo' }) })
    await expect(call(files, 'complete-task', '/projects/PROJ-0001')).rejects.toThrow(/directly in \/tasks/)
    await expect(call(files, 'complete-task', '/tasks/nested/TASK-0001')).rejects.toThrow(/directly in \/tasks/)
    await expect(call(files, 'complete-task', '/tasks/TASK-0009')).rejects.toThrow(/does not exist/)
    files.nodes.set('/tasks/PROJ', files.nodes.get('/projects/PROJ-0001'))
    await expect(call(files, 'complete-task', '/tasks/PROJ')).rejects.toThrow(/is not a task/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/tasks/TASK-0001': task() })
    const write = files.write
    files.write = async (path, content, options) => {
      files.write = write
      files.touch(path)
      return write(path, content, options)
    }
    await expect(call(files, 'complete-task', '/tasks/TASK-0001')).rejects.toThrow(/changed while it was being completed/)
    expect(files.json('/tasks/TASK-0001').stage).toBe('in-progress')
  })

  it('rejects unknown operations', async () => {
    await expect(run({ operation: 'reopen-task', path: '/tasks/TASK-0001' }, memoryFiles(), options))
      .rejects.toThrow(`Unsupported operation "reopen-task". Expected one of ${operations.join(', ')}.`)
  })
})
