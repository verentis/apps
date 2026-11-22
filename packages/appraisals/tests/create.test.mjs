import { describe, expect, it } from 'vitest'
import { defaultSettings, mimeTypes, templates } from '../src/contracts.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

const input = (creatable, parentPath, values = {}) => ({
  operation: 'create', creatable, parentPath, mime: mimeTypes[creatable],
  template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Appraisals create script', () => {
  it('creates an appraisal with the next code, create-only', async () => {
    const files = memoryFiles({ '/settings/appraisals.json': defaultSettings, '/appraisals/APR-0012': {} })
    const result = await createRecord(input('appraisal', '/appraisals', { siblings: ['APR-0012'], name: 'Thandi Dlamini' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/appraisals/APR-0013' })
    expect(files.json('/appraisals/APR-0013')).toMatchObject({
      kind: 'appraisal', code: 'APR-0013', employeeName: 'Thandi Dlamini', status: 'draft', ratings: [], overallScore: '', id: uuid(),
    })
  })

  it('defaults a new appraisal\'s manager from the settings', async () => {
    const files = memoryFiles({ '/settings/appraisals.json': { ...defaultSettings, defaultManager: 'Sipho' } })
    await createRecord(input('appraisal', '/appraisals'), settings(), files, { uuid })
    expect(files.json('/appraisals/APR-0001').manager).toBe('Sipho')
  })

  it('proposes instead of writing outside its container and rejects unknown record types', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('appraisal', '/somewhere/else'), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'APR-0001', content: { kind: 'appraisal' } })
    expect(files.writes).toEqual([])
    await expect(createRecord(input('appraisal', '/appraisals', { creatable: 'review' }), settings(), memoryFiles(), { uuid }))
      .rejects.toThrow(/Unknown Appraisals record type/)
  })
})
