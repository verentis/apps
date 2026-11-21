import { describe, expect, it } from 'vitest'
import { defaultHirePoints, hirePoints, run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const referral = (values = {}) => ({
  ...templates.referral, id: uuid(), createdAt: now, updatedAt: now, code: 'REF-0001',
  referrerName: 'Thandi Dlamini', candidateName: 'Jabu Nkosi', status: 'submitted', ...values,
})
const call = (files, operation, path = '/referrals/REF-0001') => run({ operation, path }, files, { now })

describe('Referrals hire points', () => {
  it('reads the points from the settings and falls back to the default when missing or invalid', async () => {
    expect(await hirePoints(memoryFiles({ '/settings/referrals.json': { hirePoints: 250 } }))).toBe(250)
    expect(await hirePoints(memoryFiles())).toBe(defaultHirePoints)
    expect(await hirePoints(memoryFiles({ '/settings/referrals.json': { hirePoints: '250' } }))).toBe(defaultHirePoints)
    expect(await hirePoints(memoryFiles({ '/settings/referrals.json': { hirePoints: -5 } }))).toBe(defaultHirePoints)
  })
})

describe('Referrals actions', () => {
  it.each([['submitted'], ['in-process']])('marks a %s referral hired with the points from the settings, idempotently', async status => {
    const files = memoryFiles({ '/referrals/REF-0001': referral({ status }), '/settings/referrals.json': { hirePoints: 250 } })
    expect(await call(files, 'mark-hired')).toEqual({ message: 'Marked REF-0001 hired and awarded 250 points', path: '/referrals/REF-0001' })
    expect(files.json('/referrals/REF-0001')).toMatchObject({ status: 'hired', points: 250, decidedAt: now, updatedAt: now })
    expect(await call(files, 'mark-hired')).toMatchObject({ message: 'REF-0001 is already hired (250 points awarded)' })
    expect(files.writes).toHaveLength(1)
  })

  it('awards the default points when the settings are unreadable', async () => {
    const files = memoryFiles({ '/referrals/REF-0001': referral() })
    expect(await call(files, 'mark-hired')).toMatchObject({ message: `Marked REF-0001 hired and awarded ${defaultHirePoints} points` })
    expect(files.json('/referrals/REF-0001').points).toBe(defaultHirePoints)
  })

  it('marks a referral not hired without awarding points, idempotently', async () => {
    const files = memoryFiles({ '/referrals/REF-0001': referral({ status: 'in-process' }), '/settings/referrals.json': { hirePoints: 250 } })
    expect(await call(files, 'mark-not-hired')).toEqual({ message: 'Marked REF-0001 not hired', path: '/referrals/REF-0001' })
    expect(files.json('/referrals/REF-0001')).toMatchObject({ status: 'not-hired', points: 0, decidedAt: now })
    expect(await call(files, 'mark-not-hired')).toMatchObject({ message: 'REF-0001 is already decided: not hired' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to cross the terminal statuses', async () => {
    const hired = memoryFiles({ '/referrals/REF-0001': referral({ status: 'hired', points: 100, decidedAt: now }) })
    await expect(call(hired, 'mark-not-hired')).rejects.toThrow(/only submitted or in-process referrals can be marked not hired/)
    expect(hired.json('/referrals/REF-0001').status).toBe('hired')
    const notHired = memoryFiles({ '/referrals/REF-0001': referral({ status: 'not-hired', decidedAt: now }) })
    await expect(call(notHired, 'mark-hired')).rejects.toThrow(/only submitted or in-process referrals can be marked hired/)
    expect(notHired.json('/referrals/REF-0001').status).toBe('not-hired')
    expect(notHired.writes).toHaveLength(0)
  })

  it('refuses archived referrals and anything that is not a referral in /referrals', async () => {
    const files = memoryFiles({
      '/referrals/REF-0001': referral({ state: 'archived', archivedAt: now }),
      '/referrals/odd': { kind: 'lead', name: 'Not a referral' },
    })
    await expect(call(files, 'mark-hired')).rejects.toThrow(/is archived/)
    await expect(call(files, 'mark-hired', '/referrals/odd')).rejects.toThrow(/is not a referral/)
    await expect(call(files, 'mark-hired', '/referrals/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'mark-hired', '/candidates/APP-0001')).rejects.toThrow(/directly in \/referrals/)
    await expect(call(files, 'decide')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/referrals/REF-0001': referral() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'mark-hired')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/referrals/REF-0001').status).toBe('submitted')
  })
})
