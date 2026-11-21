import { describe, expect, it } from 'vitest'
import { defaultSettings, mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (creatable, parentPath, values = {}) => ({
  operation: 'create', creatable, parentPath, mime: mimeTypes[creatable],
  template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Project create script', () => {
  it('creates a project with the next code, create-only', async () => {
    const files = memoryFiles({ '/settings/project.json': defaultSettings, '/projects/PROJ-0041': {} })
    const result = await createRecord(input('project', '/projects', { siblings: ['PROJ-0041'], name: 'Apollo' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/projects/PROJ-0042' })
    expect(files.json('/projects/PROJ-0042')).toMatchObject({ kind: 'project', code: 'PROJ-0042', name: 'Apollo', status: 'active', id: uuid() })
  })

  it('defaults a new task\'s assignee from the settings and retries a taken code', async () => {
    const files = memoryFiles({ '/settings/project.json': { ...defaultSettings, defaultAssignee: 'Thandi' }, '/tasks/TASK-0001': {} })
    const result = await createRecord(input('task', '/tasks'), settings(), files, { uuid })
    expect(result).toEqual({ path: '/tasks/TASK-0002' })
    expect(files.json('/tasks/TASK-0002')).toMatchObject({ kind: 'task', stage: 'backlog', priority: 'medium', assignee: 'Thandi' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('task', '/somewhere/else'), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'TASK-0001', content: { kind: 'task' } })
    expect(files.writes).toEqual([])
  })
})
