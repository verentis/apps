import { describe, expect, it } from 'vitest'
import { defaultSettings, mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (kind, values = {}) => ({
  operation: 'create', creatable: kind, parentPath: kind === 'shift' ? '/shifts' : '/shift-roles', mime: mimeTypes[kind],
  template: JSON.stringify(templates[kind], null, 2), now, siblings: [], ...values,
})

describe('Planning create script', () => {
  it('creates a shift with the next code, today\'s date and the default role', async () => {
    const files = memoryFiles({ '/settings/planning.json': { ...defaultSettings, defaultRole: '/shift-roles/PLR-0001' } })
    const result = await createRecord(input('shift', { siblings: ['SHF-0007'], name: 'Avery' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/shifts/SHF-0008' })
    expect(files.json('/shifts/SHF-0008')).toMatchObject({
      kind: 'shift', code: 'SHF-0008', employee: 'Avery', date: '2026-01-02', role: '/shift-roles/PLR-0001', status: 'draft', id: uuid(),
    })
  })

  it('creates a role with the PLR- prefix', async () => {
    const files = memoryFiles({ '/settings/planning.json': defaultSettings })
    expect(await createRecord(input('role', { name: 'Barista' }), settings(), files, { uuid })).toEqual({ path: '/shift-roles/PLR-0001' })
    expect(files.json('/shift-roles/PLR-0001')).toMatchObject({ kind: 'role', name: 'Barista', color: '' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('shift', { parentPath: '/somewhere/else' }), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'SHF-0001', content: { kind: 'shift' } })
    expect(files.writes).toEqual([])
  })
})
