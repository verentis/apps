import { describe, expect, it } from 'vitest'
import { overallScore, run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const ratings = [{ criteria: 'Teamwork', score: '4' }, { criteria: 'Delivery', score: '5' }, { criteria: 'Growth', score: '4' }]
const appraisal = (values = {}) => ({
  ...templates.appraisal, id: uuid(), createdAt: now, updatedAt: now, code: 'APR-0001',
  employeeName: 'Thandi Dlamini', period: '2026-H1', manager: 'Sipho', status: 'draft', ...values,
})
const call = (files, operation, path = '/appraisals/APR-0001') => run({ operation, path }, files, { now })

describe('Appraisals overall score', () => {
  it('averages the ratings as an exact decimal string, half-up to two decimals', () => {
    expect(overallScore(ratings)).toBe('4.33')
    expect(overallScore([{ criteria: 'A', score: '5' }])).toBe('5.00')
    expect(overallScore([{ criteria: 'A', score: '1' }, { criteria: 'B', score: '2' }])).toBe('1.50')
    expect(overallScore([{ criteria: 'A', score: '1' }, { criteria: 'B', score: '1' }, { criteria: 'C', score: '2' }])).toBe('1.33')
  })

  it('rejects empty ratings, blank criteria and out-of-range scores', () => {
    expect(() => overallScore([])).toThrow(/at least one rating/)
    expect(() => overallScore(undefined)).toThrow(/at least one rating/)
    expect(() => overallScore([{ criteria: '  ', score: '4' }])).toThrow(/needs its criteria/)
    expect(() => overallScore([{ criteria: 'A', score: '6' }])).toThrow(/score from 1 to 5/)
    expect(() => overallScore([{ criteria: 'A', score: '' }])).toThrow(/score from 1 to 5/)
  })
})

describe('Appraisals actions', () => {
  it('schedules a draft appraisal on its scheduled date, idempotently', async () => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ scheduledAt: '2026-04-01' }) })
    expect(await call(files, 'schedule')).toEqual({ message: 'Scheduled APR-0001 for 2026-04-01', path: '/appraisals/APR-0001' })
    expect(files.json('/appraisals/APR-0001')).toMatchObject({ status: 'scheduled', scheduledAt: '2026-04-01', updatedAt: now })
    expect(await call(files, 'schedule')).toMatchObject({ message: 'APR-0001 is already scheduled for 2026-04-01' })
    expect(files.writes).toHaveLength(1)
  })

  it('schedules for today when the scheduled date is empty', async () => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal() })
    expect(await call(files, 'schedule')).toMatchObject({ message: 'Scheduled APR-0001 for 2026-03-10' })
    expect(files.json('/appraisals/APR-0001').scheduledAt).toBe('2026-03-10')
  })

  it.each([['done'], ['cancelled']])('refuses to schedule a %s appraisal', async status => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ status, completedAt: now, cancelledAt: now, overallScore: '4.00' }) })
    await expect(call(files, 'schedule')).rejects.toThrow(/only draft appraisals can be scheduled/)
    expect(files.json('/appraisals/APR-0001').status).toBe(status)
  })

  it('completes a scheduled appraisal with the computed overall score, idempotently', async () => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ status: 'scheduled', scheduledAt: '2026-04-01', ratings }) })
    expect(await call(files, 'complete')).toEqual({ message: 'Completed APR-0001 with an overall score of 4.33', path: '/appraisals/APR-0001' })
    expect(files.json('/appraisals/APR-0001')).toMatchObject({ status: 'done', overallScore: '4.33', completedAt: now })
    expect(await call(files, 'complete')).toMatchObject({ message: 'APR-0001 is already done with an overall score of 4.33' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to complete without ratings', async () => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ status: 'scheduled', scheduledAt: '2026-04-01' }) })
    await expect(call(files, 'complete')).rejects.toThrow(/at least one rating/)
    expect(files.json('/appraisals/APR-0001').status).toBe('scheduled')
  })

  it.each([['draft'], ['cancelled']])('refuses to complete a %s appraisal', async status => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ status, cancelledAt: now, ratings }) })
    await expect(call(files, 'complete')).rejects.toThrow(/only scheduled appraisals can be completed/)
    expect(files.json('/appraisals/APR-0001').status).toBe(status)
  })

  it('refuses archived appraisals and anything that is not an appraisal in /appraisals', async () => {
    const files = memoryFiles({
      '/appraisals/APR-0001': appraisal({ state: 'archived', archivedAt: now }),
      '/appraisals/odd': { kind: 'review', name: 'Not an appraisal' },
    })
    await expect(call(files, 'schedule')).rejects.toThrow(/is archived/)
    await expect(call(files, 'schedule', '/appraisals/odd')).rejects.toThrow(/is not an appraisal/)
    await expect(call(files, 'schedule', '/appraisals/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'schedule', '/employees/EMP-0001')).rejects.toThrow(/directly in \/appraisals/)
    await expect(call(files, 'finish')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/appraisals/APR-0001': appraisal({ status: 'scheduled', scheduledAt: '2026-04-01', ratings }) })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'complete')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/appraisals/APR-0001').status).toBe('scheduled')
  })
})
