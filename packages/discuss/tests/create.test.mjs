import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecord } from '../scripts/create/main.mjs'
import { defaultSettings, starterChannel } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

const workspace = (extra = {}) => memoryFiles({
  '/settings/discuss.json': defaultSettings,
  '/channels/CH-0001': starterChannel,
  ...extra,
})

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.discuss.${kind}+json`,
  parentPath: kind === 'thread' ? '/threads' : '/channels', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Discuss create script', () => {
  it('creates a thread defaulted to the default channel', async () => {
    const files = workspace()
    const result = await createRecord(input('thread'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/threads/TH-0001' })
    expect(files.json('/threads/TH-0001')).toMatchObject({
      kind: 'thread', code: 'TH-0001', subject: 'Example', status: 'open',
      channel: '/channels/CH-0001', messages: [], draft: '', lastActivityAt: '',
    })
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('thread'), undefined, files, { uuid })
    expect(await createRecord(input('thread'), undefined, files, { uuid })).toEqual({ path: '/threads/TH-0002' })
  })

  it('creates a channel without defaults', async () => {
    const files = workspace()
    const result = await createRecord(input('channel', { siblings: ['CH-0001'] }), undefined, files, { uuid })
    expect(result).toEqual({ path: '/channels/CH-0002' })
    const record = files.json('/channels/CH-0002')
    expect(record).toMatchObject({ name: 'Example', status: 'active', members: [], createdBy: '' })
    expect(record.kind).toBe('channel')
  })

  it('returns a proposal outside its writable containers and rejects unknown kinds', async () => {
    const files = workspace()
    const proposal = await createRecord(input('thread', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('TH-0001')
    expect(proposal.content.channel).toBe('/channels/CH-0001')
    expect(files.writes).toEqual([])
    await expect(createRecord(input('thread', { creatable: 'message' }), undefined, files, { uuid }))
      .rejects.toThrow(/Unknown Discuss record type/)
  })
})
