import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecord } from '../scripts/create/main.mjs'
import { defaultSettings } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-06-01T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

const workspace = (extra = {}) => memoryFiles({
  '/settings/surveys.json': { ...defaultSettings, defaultSurvey: '/surveys/SUR-0001' },
  ...extra,
})

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.surveys.${kind}+json`,
  parentPath: kind === 'survey' ? '/surveys' : '/survey-responses', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Surveys create script', () => {
  it('creates a draft survey without questions', async () => {
    const files = workspace()
    const result = await createRecord(input('survey'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/surveys/SUR-0001' })
    expect(files.json('/surveys/SUR-0001')).toMatchObject({
      kind: 'survey', code: 'SUR-0001', title: 'Example', status: 'draft', questions: [],
    })
  })

  it('creates a response with the default survey from the settings', async () => {
    const files = workspace()
    const result = await createRecord(input('response'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/survey-responses/SRS-0001' })
    expect(files.json('/survey-responses/SRS-0001')).toMatchObject({
      kind: 'response', code: 'SRS-0001', survey: '/surveys/SUR-0001', respondentName: 'Example', status: 'draft', answers: [],
    })
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('survey'), undefined, files, { uuid })
    const result = await createRecord(input('survey'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/surveys/SUR-0002' })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('response', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('SRS-0001')
    expect(proposal.content.survey).toBe('/surveys/SUR-0001')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('survey', { creatable: 'poll' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Surveys record type/)
  })
})
