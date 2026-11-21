import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (values = {}) => ({
  operation: 'create', creatable: 'eco', parentPath: '/engineering-change-orders',
  template: JSON.stringify(templates.eco, null, 2), now, siblings: [], ...values,
})

describe('PLM create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('ECO-', 4, ['ECO-0006', 'ECO-x', 'MO-0099'])).toBe('ECO-0007')
  })

  it('drafts new change orders and respects the configured prefix and digits', () => {
    const result = propose(input({ siblings: ['ECO-0002'], name: 'Thicker legs' }), settings(), uuid)
    expect(result.name).toBe('ECO-0003')
    expect(result.content).toMatchObject({ code: 'ECO-0003', title: 'Thicker legs', stage: 'draft', type: 'change', priority: 'normal' })
    expect(propose(input({ name: 'X' }), settings({ 'eco-code-prefix': 'EC', 'code-digits': 2 }), uuid).content).toMatchObject({ code: 'EC01' })
  })

  it('writes inside its container create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/engineering-change-orders/ECO-0001': '{}' })
    const result = await createRecord({ ...input(), mime: 'application/vnd.verentis.plm.eco+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/engineering-change-orders/ECO-0002' })
    expect(files.json('/engineering-change-orders/ECO-0002')).toMatchObject({ code: 'ECO-0002', stage: 'draft' })
  })

  it('proposes instead of writing outside its container', async () => {
    const files = memoryFiles()
    const result = await createRecord(input({ parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('ECO-0001')
    expect(files.writes).toEqual([])
  })
})
