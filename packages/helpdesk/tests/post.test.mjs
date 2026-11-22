import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const ticket = (values = {}) => ({
  ...templates.ticket, id: uuid(), createdAt: now, updatedAt: now, code: 'TKT-0001',
  subject: 'Printer on fire', team: '/helpdesk-teams/TEAM-0001', stage: 'in-progress',
  slaDeadline: '2026-03-11T08:00:00Z', assignee: 'Avery', ...values,
})
const call = (files, operation, path = '/tickets/TKT-0001', extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Helpdesk ticket actions', () => {
  it('resolves an in-progress ticket with its resolution text, idempotently', async () => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ resolution: 'Replaced the fuser.' }) })
    expect(await call(files, 'resolve')).toEqual({ message: 'Resolved TKT-0001', path: '/tickets/TKT-0001' })
    expect(files.json('/tickets/TKT-0001')).toMatchObject({
      stage: 'solved', resolution: 'Replaced the fuser.', resolvedAt: now, updatedAt: now,
    })
    expect(await call(files, 'resolve')).toMatchObject({ message: 'TKT-0001 is already solved' })
    expect(files.writes).toHaveLength(1)
  })

  it('resolves a waiting ticket with the resolution passed as a parameter', async () => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ stage: 'waiting' }) })
    await call(files, 'resolve', '/tickets/TKT-0001', { resolution: '  Customer confirmed.  ' })
    expect(files.json('/tickets/TKT-0001')).toMatchObject({ stage: 'solved', resolution: 'Customer confirmed.' })
  })

  it('refuses to resolve without resolution text', async () => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ resolution: '  ' }) })
    await expect(call(files, 'resolve')).rejects.toThrow(/Enter the resolution/)
    expect(files.json('/tickets/TKT-0001').stage).toBe('in-progress')
  })

  it.each([['new'], ['closed']])('refuses to resolve a %s ticket', async stage => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ stage, resolution: 'Done.' }) })
    await expect(call(files, 'resolve')).rejects.toThrow(/only in-progress or waiting tickets can be resolved/)
    expect(files.json('/tickets/TKT-0001').stage).toBe(stage)
  })

  it('closes a solved ticket, idempotently', async () => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ stage: 'solved', resolution: 'Fixed.', resolvedAt: now }) })
    expect(await call(files, 'close')).toEqual({ message: 'Closed TKT-0001', path: '/tickets/TKT-0001' })
    expect(files.json('/tickets/TKT-0001')).toMatchObject({ stage: 'closed', closedAt: now, resolvedAt: now })
    expect(await call(files, 'close')).toMatchObject({ message: 'TKT-0001 is already closed' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['new'], ['in-progress'], ['waiting']])('refuses to close a %s ticket', async stage => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ stage }) })
    await expect(call(files, 'close')).rejects.toThrow(/only solved tickets can be closed/)
    expect(files.json('/tickets/TKT-0001').stage).toBe(stage)
  })

  it('refuses archived tickets and anything that is not a ticket in /tickets', async () => {
    const files = memoryFiles({
      '/tickets/TKT-0001': ticket({ state: 'archived', archivedAt: now, resolution: 'Done.' }),
      '/tickets/odd': { kind: 'team', name: 'Not a ticket' },
    })
    await expect(call(files, 'resolve')).rejects.toThrow(/is archived/)
    await expect(call(files, 'resolve', '/tickets/odd')).rejects.toThrow(/is not a ticket/)
    await expect(call(files, 'resolve', '/tickets/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'resolve', '/helpdesk-teams/TEAM-0001')).rejects.toThrow(/directly in \/tickets/)
    await expect(call(files, 'escalate')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/tickets/TKT-0001': ticket({ resolution: 'Done.' }) })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'resolve')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/tickets/TKT-0001').stage).toBe('in-progress')
  })
})
