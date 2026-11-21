import { describe, expect, it } from 'vitest'
import { defaultSettings, mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (values = {}) => ({
  operation: 'create', creatable: 'entry', parentPath: '/timesheets', mime: mimeTypes.entry,
  template: JSON.stringify(templates.entry, null, 2), now, siblings: [], ...values,
})

describe('Timesheets create script', () => {
  it('creates an entry with the next code, today\'s date and the default employee', async () => {
    const files = memoryFiles({ '/settings/timesheets.json': { ...defaultSettings, employee: 'Thandi' } })
    const result = await createRecord(input({ siblings: ['TS-0007'], name: 'Standup' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/timesheets/TS-0008' })
    expect(files.json('/timesheets/TS-0008')).toMatchObject({
      kind: 'entry', code: 'TS-0008', employee: 'Thandi', date: '2026-01-02', description: 'Standup', status: 'draft', hours: '', id: uuid(),
    })
  })

  it('retries a taken code with the next one', async () => {
    const files = memoryFiles({ '/settings/timesheets.json': defaultSettings, '/timesheets/TS-0001': {} })
    expect(await createRecord(input(), settings(), files, { uuid })).toEqual({ path: '/timesheets/TS-0002' })
  })

  it('proposes instead of writing outside its container', async () => {
    const files = memoryFiles()
    const result = await createRecord(input({ parentPath: '/somewhere/else' }), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'TS-0001', content: { kind: 'entry' } })
    expect(files.writes).toEqual([])
  })
})
