import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/quality-checks', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Quality create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('QCK-', 4, ['QCK-0006', 'QCK-x', 'QAL-0099'])).toBe('QCK-0007')
  })

  it('dates new checks today and respects the configured prefix and digits', () => {
    const result = propose(input('check', { siblings: ['QCK-0002'] }), settings(), uuid)
    expect(result.name).toBe('QCK-0003')
    expect(result.content).toMatchObject({ code: 'QCK-0003', date: '2026-03-04', result: 'pending', measuredValue: '' })
    expect(propose(input('point', { parentPath: '/quality-control-points', name: 'Weld seam' }), settings({ 'point-code-prefix': 'P', 'code-digits': 2 }), uuid).content)
      .toMatchObject({ code: 'P01', title: 'Weld seam', checkType: 'pass-fail', active: true })
    expect(propose(input('alert', { parentPath: '/quality-alerts', name: 'Scratches' }), settings(), uuid).content)
      .toMatchObject({ code: 'QAL-0001', title: 'Scratches', severity: 'medium', stage: 'new' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/quality-checks/QCK-0001': '{}' })
    const result = await createRecord({ ...input('check'), mime: 'application/vnd.verentis.quality.check+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/quality-checks/QCK-0002' })
    expect(files.json('/quality-checks/QCK-0002')).toMatchObject({ code: 'QCK-0002', date: '2026-03-04' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('check', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('QCK-0001')
    expect(files.writes).toEqual([])
  })
})
