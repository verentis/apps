import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const candidate = (values = {}) => ({
  ...templates.candidate, id: uuid(), createdAt: now, updatedAt: now, code: 'APP-0001',
  name: 'Thandi Dlamini', job: '/job-positions/JOB-0001', stage: 'new', ...values,
})
const call = (files, operation, path = '/candidates/APP-0001', extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Recruitment candidate actions', () => {
  it.each([['new', 'screening'], ['screening', 'interview'], ['interview', 'offer']])(
    'advances a %s candidate to %s', async (from, to) => {
      const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: from }) })
      expect(await call(files, 'advance')).toEqual({ message: `Moved APP-0001 to ${to}`, path: '/candidates/APP-0001' })
      expect(files.json('/candidates/APP-0001')).toMatchObject({ stage: to, updatedAt: now })
    })

  it('leaves a candidate already at offer alone', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'offer' }) })
    expect(await call(files, 'advance')).toMatchObject({ message: expect.stringContaining('already at the offer stage') })
    expect(files.writes).toHaveLength(0)
  })

  it.each([['hired'], ['refused']])('refuses to advance a %s candidate', async stage => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage, hiredAt: now, refusalReason: 'x' }) })
    await expect(call(files, 'advance')).rejects.toThrow(/can advance/)
    expect(files.json('/candidates/APP-0001').stage).toBe(stage)
  })

  it('hires a candidate at the offer stage, idempotently', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'offer' }) })
    expect(await call(files, 'hire')).toEqual({ message: 'Hired APP-0001', path: '/candidates/APP-0001' })
    expect(files.json('/candidates/APP-0001')).toMatchObject({ stage: 'hired', hiredAt: now, updatedAt: now })
    expect(await call(files, 'hire')).toMatchObject({ message: 'APP-0001 is already hired' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['new'], ['screening'], ['interview'], ['refused']])('refuses to hire a %s candidate', async stage => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage, refusalReason: 'No fit' }) })
    await expect(call(files, 'hire')).rejects.toThrow(/only candidates at the offer stage can be hired/)
    expect(files.json('/candidates/APP-0001').stage).toBe(stage)
  })

  it('refuses a candidate with its refusal reason, idempotently', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'screening', refusalReason: 'Salary mismatch.' }) })
    expect(await call(files, 'refuse')).toEqual({ message: 'Refused APP-0001', path: '/candidates/APP-0001' })
    expect(files.json('/candidates/APP-0001')).toMatchObject({ stage: 'refused', refusalReason: 'Salary mismatch.' })
    expect(await call(files, 'refuse')).toMatchObject({ message: 'APP-0001 is already refused' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses with the reason passed as a parameter and rejects an empty reason', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'offer' }) })
    await call(files, 'refuse', '/candidates/APP-0001', { reason: '  Withdrew.  ' })
    expect(files.json('/candidates/APP-0001')).toMatchObject({ stage: 'refused', refusalReason: 'Withdrew.' })
    const blank = memoryFiles({ '/candidates/APP-0002': candidate({ code: 'APP-0002' }) })
    await expect(call(blank, 'refuse', '/candidates/APP-0002')).rejects.toThrow(/Enter the refusal reason/)
  })

  it('refuses to refuse a hired candidate', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'hired', hiredAt: now }) })
    await expect(call(files, 'refuse', '/candidates/APP-0001', { reason: 'Oops' })).rejects.toThrow(/can be refused/)
    expect(files.json('/candidates/APP-0001').stage).toBe('hired')
  })

  it('refuses archived candidates and anything that is not a candidate in /candidates', async () => {
    const files = memoryFiles({
      '/candidates/APP-0001': candidate({ state: 'archived', archivedAt: now }),
      '/candidates/odd': { kind: 'job', title: 'Not a candidate' },
    })
    await expect(call(files, 'advance')).rejects.toThrow(/is archived/)
    await expect(call(files, 'advance', '/candidates/odd')).rejects.toThrow(/is not a candidate/)
    await expect(call(files, 'advance', '/candidates/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'advance', '/job-positions/JOB-0001')).rejects.toThrow(/directly in \/candidates/)
    await expect(call(files, 'promote')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/candidates/APP-0001': candidate({ stage: 'offer' }) })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'hire')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/candidates/APP-0001').stage).toBe('offer')
  })
})
