import { describe, expect, it } from 'vitest'
import { defaultSettings, mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (values = {}) => ({
  operation: 'create', creatable: 'task', parentPath: '/field-tasks', mime: mimeTypes.task,
  template: JSON.stringify(templates.task, null, 2), now, siblings: [], ...values,
})

describe('Field Service create script', () => {
  it('creates a task with the next code and the default technician', async () => {
    const files = memoryFiles({ '/settings/field-service.json': { ...defaultSettings, defaultTechnician: 'Sipho' } })
    const result = await createRecord(input({ siblings: ['FST-0007'], name: 'Globex' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/field-tasks/FST-0008' })
    expect(files.json('/field-tasks/FST-0008')).toMatchObject({
      kind: 'task', code: 'FST-0008', customerName: 'Globex', technician: 'Sipho', stage: 'new', type: 'install', hours: '', id: uuid(),
    })
  })

  it('retries a taken code with the next one', async () => {
    const files = memoryFiles({ '/settings/field-service.json': defaultSettings, '/field-tasks/FST-0001': {} })
    expect(await createRecord(input(), settings(), files, { uuid })).toEqual({ path: '/field-tasks/FST-0002' })
  })

  it('proposes instead of writing outside its container', async () => {
    const files = memoryFiles()
    const result = await createRecord(input({ parentPath: '/somewhere/else' }), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'FST-0001', content: { kind: 'task' } })
    expect(files.writes).toEqual([])
  })
})
