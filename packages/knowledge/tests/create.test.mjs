import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecord } from '../scripts/create/main.mjs'
import { defaultSettings, starterSpace } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/knowledge.json': defaultSettings,
    '/knowledge-spaces/KS-0001': starterSpace,
    ...extra,
  })
}

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.knowledge.${kind}+json`,
  parentPath: kind === 'article' ? '/articles' : '/knowledge-spaces', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Knowledge create script', () => {
  it('creates a draft article in the default space', async () => {
    const files = workspace()
    const result = await createRecord(input('article'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/articles/KA-0001' })
    expect(files.json('/articles/KA-0001')).toMatchObject({
      kind: 'article', code: 'KA-0001', title: 'Example', status: 'draft', body: '',
      space: '/knowledge-spaces/KS-0001', parent: '', tags: [],
    })
  })

  it('leaves the space empty when the settings are missing', async () => {
    const files = memoryFiles({})
    await createRecord(input('article'), undefined, files, { uuid })
    expect(files.json('/articles/KA-0001').space).toBe('')
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('article'), undefined, files, { uuid })
    const result = await createRecord(input('article'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/articles/KA-0002' })
  })

  it('creates a space after the highest existing sibling code', async () => {
    const files = workspace()
    const result = await createRecord(input('space', { siblings: ['KS-0001'] }), undefined, files, { uuid })
    expect(result).toEqual({ path: '/knowledge-spaces/KS-0002' })
    expect(files.json('/knowledge-spaces/KS-0002')).toMatchObject({ kind: 'space', name: 'Example', description: '', icon: '' })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('article', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('KA-0001')
    expect(proposal.content.space).toBe('/knowledge-spaces/KS-0001')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('article', { creatable: 'page' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Knowledge record type/)
  })
})
