import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const article = (values = {}) => ({
  ...templates.article, id: uuid(), createdAt: now, updatedAt: '2026-03-01T00:00:00Z', code: 'KA-0001',
  title: 'Welcome', space: '/knowledge-spaces/KS-0001', body: '# Welcome\n\nHello.', tags: ['handbook'], ...values,
})
const call = (files, operation, path = '/articles/KA-0001') => run({ operation, path }, files, { now })

describe('Knowledge article actions', () => {
  it('publishes a draft with a title and body, stamping publishedAt and updatedAt, idempotently', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article() })
    expect(await call(files, 'publish')).toEqual({ message: 'Published KA-0001', path: '/articles/KA-0001' })
    expect(files.json('/articles/KA-0001')).toMatchObject({ status: 'published', publishedAt: now, updatedAt: now })
    expect(await call(files, 'publish')).toMatchObject({ message: 'KA-0001 is already published' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['title', { title: '  ' }], ['body', { body: '' }]])('refuses to publish without a %s', async (_, values) => {
    const files = memoryFiles({ '/articles/KA-0001': article(values) })
    await expect(call(files, 'publish')).rejects.toThrow(/before publishing/)
    expect(files.json('/articles/KA-0001').status).toBe('draft')
  })

  it('refuses to publish an archived article until it is restored', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article({ status: 'archived', publishedAt: now }) })
    await expect(call(files, 'publish')).rejects.toThrow(/only draft articles can be published/)
    expect(files.json('/articles/KA-0001').status).toBe('archived')
  })

  it('archives a published article, idempotently', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article({ status: 'published', publishedAt: now }) })
    expect(await call(files, 'archive')).toEqual({ message: 'Archived KA-0001', path: '/articles/KA-0001' })
    expect(files.json('/articles/KA-0001')).toMatchObject({ status: 'archived', publishedAt: now, updatedAt: now })
    expect(await call(files, 'archive')).toMatchObject({ message: 'KA-0001 is already archived' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to archive a draft', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article() })
    await expect(call(files, 'archive')).rejects.toThrow(/only published articles can be archived/)
    expect(files.json('/articles/KA-0001').status).toBe('draft')
  })

  it('restores an archived article to draft, idempotently', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article({ status: 'archived', publishedAt: now }) })
    expect(await call(files, 'restore')).toEqual({ message: 'Restored KA-0001 to draft', path: '/articles/KA-0001' })
    expect(files.json('/articles/KA-0001')).toMatchObject({ status: 'draft', publishedAt: now, updatedAt: now })
    expect(await call(files, 'restore')).toMatchObject({ message: 'KA-0001 is already a draft' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to restore a published article', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article({ status: 'published', publishedAt: now }) })
    await expect(call(files, 'restore')).rejects.toThrow(/only archived articles can be restored/)
    expect(files.json('/articles/KA-0001').status).toBe('published')
  })

  it('refuses archived records and anything that is not an article in /articles', async () => {
    const files = memoryFiles({
      '/articles/KA-0001': article({ state: 'archived', archivedAt: now }),
      '/articles/odd': { kind: 'space', name: 'Not an article' },
    })
    await expect(call(files, 'publish')).rejects.toThrow(/is archived/)
    await expect(call(files, 'publish', '/articles/odd')).rejects.toThrow(/is not an article/)
    await expect(call(files, 'publish', '/articles/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'publish', '/knowledge-spaces/KS-0001')).rejects.toThrow(/directly in \/articles/)
    await expect(call(files, 'translate')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/articles/KA-0001': article() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'publish')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/articles/KA-0001').status).toBe('draft')
  })
})
