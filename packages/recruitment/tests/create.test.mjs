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

describe('Recruitment create script', () => {
  it('creates a job position with the next code, create-only', async () => {
    const files = memoryFiles({ '/settings/recruitment.json': defaultSettings, '/job-positions/JOB-0007': {} })
    const result = await createRecord(input('job', '/job-positions', { siblings: ['JOB-0007'], name: 'Backend engineer' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/job-positions/JOB-0008' })
    expect(files.json('/job-positions/JOB-0008')).toMatchObject({
      kind: 'job', code: 'JOB-0008', title: 'Backend engineer', status: 'open', openings: 1, id: uuid(),
    })
  })

  it('defaults a new candidate\'s job position from the settings and retries a taken code', async () => {
    const files = memoryFiles({
      '/settings/recruitment.json': { ...defaultSettings, defaultJob: '/job-positions/JOB-0001' },
      '/candidates/APP-0001': {},
    })
    const result = await createRecord(input('candidate', '/candidates'), settings(), files, { uuid })
    expect(result).toEqual({ path: '/candidates/APP-0002' })
    expect(files.json('/candidates/APP-0002')).toMatchObject({
      kind: 'candidate', stage: 'new', source: 'website', job: '/job-positions/JOB-0001', expectedSalary: '',
    })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('candidate', '/somewhere/else'), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'APP-0001', content: { kind: 'candidate' } })
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('candidate', '/candidates', { creatable: 'vacancy' }), settings(), memoryFiles(), { uuid }))
      .rejects.toThrow(/Unknown Recruitment record type/)
  })
})
