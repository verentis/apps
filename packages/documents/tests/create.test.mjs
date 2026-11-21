import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyWorkspaceTags, createRecord } from '../scripts/create/main.mjs'
import { defaultSettings, starterWorkspaces } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')
const [finance, legal] = starterWorkspaces

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/documents.json': defaultSettings,
    '/document-workspaces/DWS-0001': finance,
    '/document-workspaces/DWS-0002': legal,
    ...extra,
  })
}

const parents = { workspace: '/document-workspaces', document: '/document-cards', tag: '/document-tags' }
const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.documents.${kind}+json`,
  parentPath: parents[kind], template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Documents create script', () => {
  it('creates a document card in the default workspace with its default tags', async () => {
    const files = workspace()
    const result = await createRecord(input('document'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/document-cards/DOC-0001' })
    const card = files.json('/document-cards/DOC-0001')
    expect(card).toMatchObject({
      kind: 'document', code: 'DOC-0001', title: 'Example', status: 'inbox', filePath: '',
      workspace: '/document-workspaces/DWS-0001', tags: ['finance', 'invoice'],
    })
  })

  it('leaves the tags empty when the workspace is missing or unreadable', async () => {
    const files = memoryFiles({ '/settings/documents.json': defaultSettings })
    await createRecord(input('document'), undefined, files, { uuid })
    expect(files.json('/document-cards/DOC-0001').tags).toEqual([])
    const record = { kind: 'document', workspace: '', tags: [] }
    expect((await applyWorkspaceTags(record, files)).tags).toEqual([])
  })

  it('keeps tags that are already set and skips non-workspace references', async () => {
    const files = workspace({ '/document-workspaces/DWS-0003': { kind: 'tag', label: 'oops' } })
    const kept = { kind: 'document', workspace: '/document-workspaces/DWS-0001', tags: ['custom'] }
    expect((await applyWorkspaceTags(kept, files)).tags).toEqual(['custom'])
    const odd = { kind: 'document', workspace: '/document-workspaces/DWS-0003', tags: [] }
    expect((await applyWorkspaceTags(odd, files)).tags).toEqual([])
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('document'), undefined, files, { uuid })
    const result = await createRecord(input('document'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/document-cards/DOC-0002' })
  })

  it('creates workspaces and tags without a tag computation', async () => {
    const files = workspace()
    const created = await createRecord(input('workspace', { siblings: ['DWS-0001', 'DWS-0002'] }), undefined, files, { uuid })
    expect(created).toEqual({ path: '/document-workspaces/DWS-0003' })
    expect(files.json('/document-workspaces/DWS-0003')).toMatchObject({ kind: 'workspace', name: 'Example', defaultTags: [] })
    expect(await createRecord(input('tag'), undefined, files, { uuid })).toEqual({ path: '/document-tags/DTG-0001' })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('document', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('DOC-0001')
    expect(proposal.content.tags).toEqual(['finance', 'invoice'])
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('document', { creatable: 'folderish' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Documents record type/)
  })
})
