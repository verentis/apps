import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/stock-moves', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Inventory create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('MOV-', 4, ['MOV-0006', 'MOV-x', 'PRD-0099'])).toBe('MOV-0007')
  })

  it('dates new moves today and respects the configured prefix and digits', () => {
    const result = propose(input('move', { siblings: ['MOV-0002'], name: 'Restock' }), settings(), uuid)
    expect(result.name).toBe('MOV-0003')
    expect(result.content).toMatchObject({ code: 'MOV-0003', reference: 'Restock', date: '2026-03-04', status: 'draft' })
    expect(propose(input('move', { name: 'X' }), settings({ 'move-code-prefix': 'M', 'code-digits': 2 }), uuid).content)
      .toMatchObject({ code: 'M01' })
  })

  it('defaults new adjustments to today and the default warehouse from the Inventory settings', () => {
    const documents = { '/settings/inventory.json': { defaultWarehouse: '/warehouses/WH-0001' } }
    const result = propose(input('adjustment', { parentPath: '/inventory-adjustments' }), settings(), uuid, documents)
    expect(result.content).toMatchObject({ code: 'ADJ-0001', date: '2026-03-04', warehouse: '/warehouses/WH-0001', status: 'draft' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/settings/inventory.json': { defaultWarehouse: '' }, '/stock-moves/MOV-0001': '{}' })
    const result = await createRecord({ ...input('move'), mime: 'application/vnd.verentis.inventory.move+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/stock-moves/MOV-0002' })
    expect(files.json('/stock-moves/MOV-0002')).toMatchObject({ code: 'MOV-0002', date: '2026-03-04' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('move', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('MOV-0001')
    expect(files.writes).toEqual([])
  })
})
