import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applySlaDeadline, createRecord } from '../scripts/create/main.mjs'
import { defaultSettings, starterTeam } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/helpdesk.json': defaultSettings,
    '/helpdesk-teams/TEAM-0001': starterTeam,
    ...extra,
  })
}

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.helpdesk.${kind}+json`,
  parentPath: kind === 'ticket' ? '/tickets' : '/helpdesk-teams', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Helpdesk create script', () => {
  it('creates a ticket with the default team and an SLA deadline 24 hours out', async () => {
    const files = workspace()
    const result = await createRecord(input('ticket'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/tickets/TKT-0001' })
    const ticket = files.json('/tickets/TKT-0001')
    expect(ticket).toMatchObject({
      kind: 'ticket', code: 'TKT-0001', subject: 'Example', stage: 'new', priority: 'normal',
      team: '/helpdesk-teams/TEAM-0001', createdAt: '2026-03-10T08:00:00.000Z', slaDeadline: '2026-03-11T08:00:00Z',
    })
  })

  it('leaves the deadline empty when the team is missing or unreadable', async () => {
    const files = memoryFiles({ '/settings/helpdesk.json': defaultSettings })
    await createRecord(input('ticket'), undefined, files, { uuid })
    expect(files.json('/tickets/TKT-0001').slaDeadline).toBe('')
    const record = { kind: 'ticket', team: '', slaDeadline: '', createdAt: now }
    expect((await applySlaDeadline(record, files)).slaDeadline).toBe('')
  })

  it('refuses a team without valid SLA hours and keeps an existing deadline', async () => {
    const files = workspace({ '/helpdesk-teams/TEAM-0002': { ...starterTeam, code: 'TEAM-0002', slaHours: 0 } })
    const zero = { kind: 'ticket', team: '/helpdesk-teams/TEAM-0002', slaDeadline: '', createdAt: now }
    expect((await applySlaDeadline(zero, files)).slaDeadline).toBe('')
    const kept = { kind: 'ticket', team: '/helpdesk-teams/TEAM-0001', slaDeadline: '2026-01-01T00:00:00Z', createdAt: now }
    expect((await applySlaDeadline(kept, files)).slaDeadline).toBe('2026-01-01T00:00:00Z')
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('ticket'), undefined, files, { uuid })
    const result = await createRecord(input('ticket'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/tickets/TKT-0002' })
  })

  it('creates a team without a deadline computation', async () => {
    const files = workspace()
    const result = await createRecord(input('team', { siblings: ['TEAM-0001'] }), undefined, files, { uuid })
    expect(result).toEqual({ path: '/helpdesk-teams/TEAM-0002' })
    expect(files.json('/helpdesk-teams/TEAM-0002')).toMatchObject({ kind: 'team', name: 'Example', slaHours: 24 })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('ticket', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('TKT-0001')
    expect(proposal.content.slaDeadline).toBe('2026-03-11T08:00:00Z')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('ticket', { creatable: 'customer' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Helpdesk record type/)
  })
})
