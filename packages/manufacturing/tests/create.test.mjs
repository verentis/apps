import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/manufacturing-orders', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Manufacturing create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('MO-', 4, ['MO-0006', 'MO-x', 'BOM-0099'])).toBe('MO-0007')
  })

  it('schedules new orders today and respects the configured prefix and digits', () => {
    const result = propose(input('order', { siblings: ['MO-0002'] }), settings(), uuid)
    expect(result.name).toBe('MO-0003')
    expect(result.content).toMatchObject({ code: 'MO-0003', scheduledDate: '2026-03-04', status: 'draft', demand: [] })
    expect(propose(input('bom', { parentPath: '/bills-of-materials', name: 'Desk' }), settings({ 'bom-code-prefix': 'B', 'code-digits': 2 }), uuid).content)
      .toMatchObject({ code: 'B01', productName: 'Desk', outputQty: '1' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/manufacturing-orders/MO-0001': '{}' })
    const result = await createRecord({ ...input('order'), mime: 'application/vnd.verentis.manufacturing.order+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/manufacturing-orders/MO-0002' })
    expect(files.json('/manufacturing-orders/MO-0002')).toMatchObject({ code: 'MO-0002', scheduledDate: '2026-03-04' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('order', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('MO-0001')
    expect(files.writes).toEqual([])
  })
})
