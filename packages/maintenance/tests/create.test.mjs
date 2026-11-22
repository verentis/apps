import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/maintenance-requests', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Maintenance create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('MREQ-', 4, ['MREQ-0006', 'MREQ-x', 'EQP-0099'])).toBe('MREQ-0007')
  })

  it('schedules new requests today and respects the configured prefix and digits', () => {
    const result = propose(input('request', { siblings: ['MREQ-0002'] }), settings(), uuid)
    expect(result.name).toBe('MREQ-0003')
    expect(result.content).toMatchObject({ code: 'MREQ-0003', scheduledDate: '2026-03-04', stage: 'new', type: 'corrective', priority: 'normal', durationHours: '' })
    expect(propose(input('equipment', { parentPath: '/equipment', name: 'CNC mill' }), settings({ 'equipment-code-prefix': 'EQ', 'code-digits': 2 }), uuid).content)
      .toMatchObject({ code: 'EQ01', name: 'CNC mill', status: 'operational', purchaseDate: '' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/maintenance-requests/MREQ-0001': '{}' })
    const result = await createRecord({ ...input('request'), mime: 'application/vnd.verentis.maintenance.request+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/maintenance-requests/MREQ-0002' })
    expect(files.json('/maintenance-requests/MREQ-0002')).toMatchObject({ code: 'MREQ-0002', scheduledDate: '2026-03-04' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('request', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('MREQ-0001')
    expect(files.writes).toEqual([])
  })
})
