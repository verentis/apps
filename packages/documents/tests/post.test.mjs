import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const doc = (values = {}) => ({
  ...templates.document, id: uuid(), createdAt: now, updatedAt: now, code: 'DOC-0001',
  title: 'Acme invoice', filePath: '/shared/finance/acme.pdf', workspace: '/document-workspaces/DWS-0001',
  tags: ['finance'], ...values,
})
const call = (files, operation, path = '/document-cards/DOC-0001', extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Documents workflow actions', () => {
  it('sends an inbox document to review, idempotently', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc() })
    expect(await call(files, 'send-to-review')).toEqual({ message: 'Sent DOC-0001 to review', path: '/document-cards/DOC-0001' })
    expect(files.json('/document-cards/DOC-0001')).toMatchObject({ status: 'in-review', updatedAt: now })
    expect(await call(files, 'send-to-review')).toMatchObject({ message: 'DOC-0001 is already in review' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['validated'], ['archived-status']])('refuses to send a %s document to review', async status => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status, validatedAt: now }) })
    await expect(call(files, 'send-to-review')).rejects.toThrow(/only inbox documents can be sent to review/)
    expect(files.json('/document-cards/DOC-0001').status).toBe(status)
  })

  it('validates a document in review, stamping validatedAt, idempotently', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status: 'in-review' }) })
    expect(await call(files, 'validate')).toEqual({ message: 'Validated DOC-0001', path: '/document-cards/DOC-0001' })
    expect(files.json('/document-cards/DOC-0001')).toMatchObject({ status: 'validated', validatedAt: now, updatedAt: now })
    expect(await call(files, 'validate')).toMatchObject({ message: 'DOC-0001 is already validated' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['inbox'], ['archived-status']])('refuses to validate a %s document', async status => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status, ...(status === 'archived-status' ? { validatedAt: now } : {}) }) })
    await expect(call(files, 'validate')).rejects.toThrow(/only documents in review can be validated/)
    expect(files.json('/document-cards/DOC-0001').status).toBe(status)
  })

  it('archives a validated document, keeping its validation stamp, idempotently', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status: 'validated', validatedAt: now }) })
    expect(await call(files, 'archive')).toEqual({ message: 'Archived DOC-0001', path: '/document-cards/DOC-0001' })
    expect(files.json('/document-cards/DOC-0001')).toMatchObject({ status: 'archived-status', validatedAt: now })
    expect(await call(files, 'archive')).toMatchObject({ message: 'DOC-0001 is already archived' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['inbox'], ['in-review']])('refuses to archive a %s document', async status => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status }) })
    await expect(call(files, 'archive')).rejects.toThrow(/only validated documents can be archived/)
    expect(files.json('/document-cards/DOC-0001').status).toBe(status)
  })

  it('returns a document in review to the inbox with its review comment, idempotently', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status: 'in-review', reviewComment: 'Wrong workspace.' }) })
    expect(await call(files, 'return-to-inbox')).toEqual({ message: 'Returned DOC-0001 to the inbox', path: '/document-cards/DOC-0001' })
    expect(files.json('/document-cards/DOC-0001')).toMatchObject({ status: 'inbox', reviewComment: 'Wrong workspace.' })
    expect(await call(files, 'return-to-inbox')).toMatchObject({ message: 'DOC-0001 is already in the inbox' })
    expect(files.writes).toHaveLength(1)
  })

  it('returns with a comment passed as a parameter and refuses without one', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status: 'in-review' }) })
    await expect(call(files, 'return-to-inbox')).rejects.toThrow(/Enter the review comment/)
    await call(files, 'return-to-inbox', '/document-cards/DOC-0001', { comment: '  Needs the signed copy.  ' })
    expect(files.json('/document-cards/DOC-0001')).toMatchObject({ status: 'inbox', reviewComment: 'Needs the signed copy.' })
  })

  it.each([['validated'], ['archived-status']])('refuses to return a %s document to the inbox', async status => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc({ status, validatedAt: now, reviewComment: 'x' }) })
    await expect(call(files, 'return-to-inbox')).rejects.toThrow(/only documents in review can be returned/)
    expect(files.json('/document-cards/DOC-0001').status).toBe(status)
  })

  it('never writes the referenced VFS file, only the card', async () => {
    const files = memoryFiles({
      '/document-cards/DOC-0001': doc(),
      '/shared/finance/acme.pdf': 'binary',
    })
    await call(files, 'send-to-review')
    expect(files.writes).toEqual(['/document-cards/DOC-0001'])
  })

  it('refuses archived cards and anything that is not a document card in /document-cards', async () => {
    const files = memoryFiles({
      '/document-cards/DOC-0001': doc({ state: 'archived', archivedAt: now }),
      '/document-cards/odd': { kind: 'tag', label: 'Not a card' },
    })
    await expect(call(files, 'send-to-review')).rejects.toThrow(/is archived/)
    await expect(call(files, 'send-to-review', '/document-cards/odd')).rejects.toThrow(/is not a document card/)
    await expect(call(files, 'send-to-review', '/document-cards/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'send-to-review', '/document-workspaces/DWS-0001')).rejects.toThrow(/directly in \/document-cards/)
    await expect(call(files, 'promote')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/document-cards/DOC-0001': doc() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'send-to-review')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/document-cards/DOC-0001').status).toBe('inbox')
  })
})
