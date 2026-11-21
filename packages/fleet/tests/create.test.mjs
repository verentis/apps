import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/service-logs', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Fleet create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('FSRV-', 4, ['FSRV-0006', 'FSRV-x', 'VEH-0099'])).toBe('FSRV-0007')
  })

  it('dates new service logs today and respects the configured prefix and digits', () => {
    const result = propose(input('service', { siblings: ['FSRV-0002'], name: 'Oil change' }), settings(), uuid)
    expect(result.name).toBe('FSRV-0003')
    expect(result.content).toMatchObject({ code: 'FSRV-0003', description: 'Oil change', date: '2026-03-04', status: 'draft' })
    expect(propose(input('vehicle', { parentPath: '/vehicles' }), settings({ 'vehicle-code-prefix': 'V', 'code-digits': 2 }), uuid).content)
      .toMatchObject({ code: 'V01', status: 'active' })
  })

  it('starts new contracts today as active drafts of their term', () => {
    const result = propose(input('contract', { parentPath: '/fleet-contracts', name: 'AutoLease Co' }), settings(), uuid)
    expect(result.content).toMatchObject({ code: 'FCON-0001', vendor: 'AutoLease Co', startDate: '2026-03-04', endDate: '', status: 'active' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/service-logs/FSRV-0001': '{}' })
    const result = await createRecord({ ...input('service'), mime: 'application/vnd.verentis.fleet.service+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/service-logs/FSRV-0002' })
    expect(files.json('/service-logs/FSRV-0002')).toMatchObject({ code: 'FSRV-0002', date: '2026-03-04' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('service', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('FSRV-0001')
    expect(files.writes).toEqual([])
  })
})
