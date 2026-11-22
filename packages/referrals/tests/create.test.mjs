import { describe, expect, it } from 'vitest'
import { mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (creatable, parentPath, values = {}) => ({
  operation: 'create', creatable, parentPath, mime: mimeTypes[creatable],
  template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Referrals create script', () => {
  it('creates a referral with the next code, create-only', async () => {
    const files = memoryFiles({ '/referrals/REF-0012': {} })
    const result = await createRecord(input('referral', '/referrals', { siblings: ['REF-0012'], name: 'Thandi Dlamini' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/referrals/REF-0013' })
    expect(files.json('/referrals/REF-0013')).toMatchObject({
      kind: 'referral', code: 'REF-0013', referrerName: 'Thandi Dlamini', status: 'submitted', points: 0, id: uuid(),
    })
  })

  it('honours the code prefix and digits settings', async () => {
    const files = memoryFiles()
    await createRecord(input('referral', '/referrals'), settings({ 'referral-code-prefix': 'RF-', 'code-digits': 6 }), files, { uuid })
    expect(files.json('/referrals/RF-000001').code).toBe('RF-000001')
  })

  it('proposes instead of writing outside its container and rejects unknown record types', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('referral', '/somewhere/else'), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'REF-0001', content: { kind: 'referral' } })
    expect(files.writes).toEqual([])
    await expect(createRecord(input('referral', '/referrals', { creatable: 'lead' }), settings(), memoryFiles(), { uuid }))
      .rejects.toThrow(/Unknown Referrals record type/)
  })
})
