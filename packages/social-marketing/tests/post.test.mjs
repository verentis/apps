import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-04-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const account = (values = {}) => ({
  ...templates.account, id: uuid(), createdAt: now, updatedAt: now, code: 'SOA-0001',
  network: 'mastodon', handle: '@verentis', active: true, ...values,
})
const post = (values = {}) => ({
  ...templates.post, id: uuid(), createdAt: now, updatedAt: now, code: 'SOP-0001',
  content: 'Launch day!', account: '/social-accounts/SOA-0001', ...values,
})
const workspace = (values = {}, accountValues = {}) => memoryFiles({
  '/social-accounts/SOA-0001': account(accountValues),
  '/social-posts/SOP-0001': post(values),
})
const call = (files, operation, path = '/social-posts/SOP-0001') => run({ operation, path }, files, { now })

describe('Social Marketing post actions', () => {
  it('schedules a draft post with its scheduled date, idempotently', async () => {
    const files = workspace({ scheduledDate: '2026-04-12' })
    expect(await call(files, 'schedule')).toEqual({ message: 'Scheduled SOP-0001 for 2026-04-12', path: '/social-posts/SOP-0001' })
    expect(files.json('/social-posts/SOP-0001')).toMatchObject({ status: 'scheduled', updatedAt: now })
    expect(await call(files, 'schedule')).toMatchObject({ message: 'SOP-0001 is already scheduled' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to schedule without a scheduled date or from published', async () => {
    await expect(call(workspace(), 'schedule')).rejects.toThrow(/Set the scheduled date/)
    const published = workspace({ status: 'published', publishedAt: now, scheduledDate: '2026-04-12' })
    await expect(call(published, 'schedule')).rejects.toThrow(/only draft posts can be scheduled/)
  })

  it('publishes a draft or scheduled post through its active account, idempotently', async () => {
    const files = workspace({ status: 'scheduled', scheduledDate: '2026-04-12' })
    expect(await call(files, 'publish')).toEqual({ message: 'Published SOP-0001 as @verentis', path: '/social-posts/SOP-0001' })
    expect(files.json('/social-posts/SOP-0001')).toMatchObject({ status: 'published', publishedAt: now, updatedAt: now })
    expect(await call(files, 'publish')).toMatchObject({ message: 'SOP-0001 was already published' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to publish without content, a valid active account, or from cancelled', async () => {
    await expect(call(workspace({ content: '  ' }), 'publish')).rejects.toThrow(/Write the content/)
    await expect(call(workspace({ account: '' }), 'publish')).rejects.toThrow(/needs a social account/)
    await expect(call(workspace({ account: '/social-accounts/SOA-0404' }), 'publish')).rejects.toThrow(/could not be read/)
    await expect(call(workspace({}, { active: false }), 'publish')).rejects.toThrow(/is inactive/)
    await expect(call(workspace({}, { state: 'archived', archivedAt: now }), 'publish')).rejects.toThrow(/is archived/)
    const cancelled = workspace({ status: 'cancelled', cancelledAt: now })
    await expect(call(cancelled, 'publish')).rejects.toThrow(/only draft or scheduled posts can be published/)
  })

  it('cancels a draft or scheduled post, idempotently, but never a published one', async () => {
    const files = workspace()
    expect(await call(files, 'cancel')).toEqual({ message: 'Cancelled SOP-0001', path: '/social-posts/SOP-0001' })
    expect(files.json('/social-posts/SOP-0001')).toMatchObject({ status: 'cancelled', cancelledAt: now })
    expect(await call(files, 'cancel')).toMatchObject({ message: 'SOP-0001 is already cancelled' })
    expect(files.writes).toHaveLength(1)
    const published = workspace({ status: 'published', publishedAt: now })
    await expect(call(published, 'cancel')).rejects.toThrow(/only draft or scheduled posts can be cancelled/)
  })

  it('refuses archived posts and anything that is not a post in /social-posts', async () => {
    const files = memoryFiles({
      '/social-posts/SOP-0001': post({ state: 'archived', archivedAt: now }),
      '/social-posts/odd': { kind: 'account', name: 'Not a post' },
    })
    await expect(call(files, 'publish')).rejects.toThrow(/is archived/)
    await expect(call(files, 'publish', '/social-posts/odd')).rejects.toThrow(/is not a post/)
    await expect(call(files, 'publish', '/social-posts/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'publish', '/social-accounts/SOA-0001')).rejects.toThrow(/directly in \/social-posts/)
    await expect(call(files, 'boost')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'publish')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/social-posts/SOP-0001').status).toBe('draft')
  })
})
