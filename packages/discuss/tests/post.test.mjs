import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { starterChannel, templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const thread = (values = {}) => ({
  ...templates.thread, id: uuid(), createdAt: now, updatedAt: now, code: 'TH-0001',
  subject: 'Release plan', channel: '/channels/CH-0001', startedBy: 'Avery', status: 'open',
  messages: [{ sequence: 1, author: 'Avery', date: '2026-03-09T08:00:00Z', body: 'Kickoff', edited: false }],
  lastActivityAt: '2026-03-09T08:00:00Z', ...values,
})
const channel = (values = {}) => ({ ...starterChannel, ...values })
const workspace = (values = {}, channelValues = {}) => memoryFiles({
  '/channels/CH-0001': channel(channelValues),
  '/threads/TH-0001': thread(values),
})
const call = (files, operation, extra = {}, path = '/threads/TH-0001') => run({ operation, path, ...extra }, files, { now })

describe('Discuss post-message', () => {
  it('appends the next message, stamps lastActivityAt and clears the draft', async () => {
    const files = workspace({ draft: 'A draft to clear' })
    const result = await call(files, 'post-message', { body: '  Ship **Friday**.  ', author: ' Jordan ', key: 'k-1' })
    expect(result).toEqual({ message: 'Posted message 2 to TH-0001', path: '/threads/TH-0001' })
    const saved = files.json('/threads/TH-0001')
    expect(saved.messages).toHaveLength(2)
    expect(saved.messages[1]).toEqual({ sequence: 2, author: 'Jordan', date: now, body: 'Ship **Friday**.', edited: false, key: 'k-1' })
    expect(saved).toMatchObject({ lastActivityAt: now, updatedAt: now, draft: '' })
  })

  it('does not double-append when a retry reuses the idempotency key', async () => {
    const files = workspace()
    await call(files, 'post-message', { body: 'Once only', key: 'retry-1' })
    const retried = await call(files, 'post-message', { body: 'Once only', key: 'retry-1' })
    expect(retried).toMatchObject({ message: 'The message is already posted to TH-0001' })
    expect(files.json('/threads/TH-0001').messages).toHaveLength(2)
    expect(files.writes).toHaveLength(1)
  })

  it('appends twice with distinct keys and numbers past the highest sequence', async () => {
    const files = workspace({ messages: [{ sequence: 7, author: 'A', date: now, body: 'Seven', edited: false }] })
    await call(files, 'post-message', { body: 'Eight', key: 'k-8' })
    await call(files, 'post-message', { body: 'Nine', key: 'k-9' })
    expect(files.json('/threads/TH-0001').messages.map(message => message.sequence)).toEqual([7, 8, 9])
  })

  it('rejects an empty body', async () => {
    const files = workspace()
    await expect(call(files, 'post-message', { body: '   ' })).rejects.toThrow(/Enter a message/)
    expect(files.writes).toEqual([])
  })

  it.each([['resolved'], ['locked']])('rejects posting to a %s thread', async status => {
    const files = workspace({ status, resolvedAt: now, ...(status === 'locked' ? { lockedAt: now } : {}) })
    await expect(call(files, 'post-message', { body: 'Hi' })).rejects.toThrow(/only open threads accept messages/)
    expect(files.writes).toEqual([])
  })

  it('rejects posting into an archived channel', async () => {
    const files = workspace({}, { status: 'archived' })
    await expect(call(files, 'post-message', { body: 'Hi' })).rejects.toThrow(/CH-0001 is archived and no longer accepts messages/)
    expect(files.writes).toEqual([])
  })

  it('rejects threads without a readable channel', async () => {
    const missing = memoryFiles({ '/threads/TH-0001': thread({ channel: '/channels/CH-0404' }) })
    await expect(call(missing, 'post-message', { body: 'Hi' })).rejects.toThrow(/could not be read/)
    const none = memoryFiles({ '/threads/TH-0001': thread({ channel: '' }) })
    await expect(call(none, 'post-message', { body: 'Hi' })).rejects.toThrow(/has no channel/)
  })
})

describe('Discuss thread transitions', () => {
  it('resolves an open thread, idempotently', async () => {
    const files = workspace()
    expect(await call(files, 'resolve-thread')).toEqual({ message: 'Resolved TH-0001', path: '/threads/TH-0001' })
    expect(files.json('/threads/TH-0001')).toMatchObject({ status: 'resolved', resolvedAt: now, updatedAt: now })
    expect(await call(files, 'resolve-thread')).toMatchObject({ message: 'TH-0001 is already resolved' })
    expect(files.writes).toHaveLength(1)
  })

  it('locks a resolved thread, idempotently, and refuses to lock an open one', async () => {
    const files = workspace({ status: 'resolved', resolvedAt: now })
    expect(await call(files, 'lock-thread')).toEqual({ message: 'Locked TH-0001', path: '/threads/TH-0001' })
    expect(files.json('/threads/TH-0001')).toMatchObject({ status: 'locked', lockedAt: now })
    expect(await call(files, 'lock-thread')).toMatchObject({ message: 'TH-0001 is already locked' })
    expect(files.writes).toHaveLength(1)
    const open = workspace()
    await expect(call(open, 'lock-thread')).rejects.toThrow(/only resolved threads can be locked/)
  })

  it('reopens a resolved thread and clears the resolution stamp', async () => {
    const files = workspace({ status: 'resolved', resolvedAt: now })
    expect(await call(files, 'reopen-thread')).toEqual({ message: 'Reopened TH-0001', path: '/threads/TH-0001' })
    const saved = files.json('/threads/TH-0001')
    expect(saved.status).toBe('open')
    expect(saved).not.toHaveProperty('resolvedAt')
    expect(await call(files, 'reopen-thread')).toMatchObject({ message: 'TH-0001 is already open' })
  })

  it('refuses to resolve or reopen a locked thread', async () => {
    const files = workspace({ status: 'locked', resolvedAt: now, lockedAt: now })
    await expect(call(files, 'resolve-thread')).rejects.toThrow(/only open threads can be resolved/)
    await expect(call(files, 'reopen-thread')).rejects.toThrow(/only resolved threads can be reopened/)
    expect(files.writes).toEqual([])
  })

  it('refuses archived records and anything that is not a thread in /threads', async () => {
    const files = memoryFiles({
      '/threads/TH-0001': thread({ state: 'archived', archivedAt: now }),
      '/threads/odd': { kind: 'channel', name: 'Not a thread' },
    })
    await expect(call(files, 'resolve-thread')).rejects.toThrow(/is archived/)
    await expect(call(files, 'resolve-thread', {}, '/threads/odd')).rejects.toThrow(/is not a thread/)
    await expect(call(files, 'resolve-thread', {}, '/threads/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'resolve-thread', {}, '/channels/CH-0001')).rejects.toThrow(/directly in \/threads/)
    await expect(call(files, 'escalate')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'post-message', { body: 'Hi' })).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/threads/TH-0001').messages).toHaveLength(1)
  })
})

describe('Discuss archive-channel', () => {
  it('archives an active channel, idempotently', async () => {
    const files = workspace()
    expect(await call(files, 'archive-channel', {}, '/channels/CH-0001')).toEqual({ message: 'Archived CH-0001', path: '/channels/CH-0001' })
    expect(files.json('/channels/CH-0001')).toMatchObject({ status: 'archived', updatedAt: now })
    expect(await call(files, 'archive-channel', {}, '/channels/CH-0001')).toMatchObject({ message: 'CH-0001 is already archived' })
    expect(files.writes).toHaveLength(1)
    await expect(call(files, 'post-message', { body: 'Hi' })).rejects.toThrow(/archived and no longer accepts messages/)
  })

  it('only accepts channels directly in /channels', async () => {
    const files = workspace()
    await expect(call(files, 'archive-channel', {}, '/threads/TH-0001')).rejects.toThrow(/directly in \/channels/)
  })
})
