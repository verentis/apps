import { describe, expect, it } from 'vitest'
import { run, checkSchedule, findOverlap } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const shift = (values = {}) => ({
  ...templates.shift, id: uuid(), createdAt: now, updatedAt: now, code: 'SHF-0001',
  employee: 'Avery', role: '/shift-roles/PLR-0001', date: '2026-03-12', startTime: '08:00', endTime: '16:00',
  status: 'draft', ...values,
})
const call = (files, operation, path = '/shifts/SHF-0001') => run({ operation, path }, files, { now })

describe('Planning shift actions', () => {
  it('publishes a complete draft shift, idempotently', async () => {
    const files = memoryFiles({ '/shifts/SHF-0001': shift() })
    expect(await call(files, 'publish')).toEqual({ message: 'Published SHF-0001 for Avery on 2026-03-12', path: '/shifts/SHF-0001' })
    expect(files.json('/shifts/SHF-0001')).toMatchObject({ status: 'published', publishedAt: now, updatedAt: now })
    expect(await call(files, 'publish')).toMatchObject({ message: 'SHF-0001 is already published' })
    expect(files.writes).toHaveLength(1)
  })

  it('requires a complete schedule with the end after the start', async () => {
    for (const [values, error] of [
      [{ date: '' }, /needs a date/],
      [{ startTime: '' }, /needs a start time/],
      [{ endTime: '' }, /needs an end time/],
      [{ startTime: '16:00', endTime: '08:00' }, /must end after it starts/],
      [{ startTime: '08:00', endTime: '08:00' }, /must end after it starts/],
      [{ employee: '  ' }, /needs an employee/],
    ]) {
      const files = memoryFiles({ '/shifts/SHF-0001': shift(values) })
      await expect(call(files, 'publish')).rejects.toThrow(error)
      expect(files.writes).toEqual([])
    }
    expect(() => checkSchedule(shift({ endTime: '8:00' }))).toThrow(/needs an end time/)
  })

  it('rejects publishing a shift that overlaps the employee\'s published or confirmed shift', async () => {
    const other = shift({ code: 'SHF-0002', startTime: '12:00', endTime: '20:00', status: 'published', publishedAt: now })
    const files = memoryFiles({ '/shifts/SHF-0001': shift(), '/shifts/SHF-0002': other })
    await expect(call(files, 'publish')).rejects.toThrow(/SHF-0001 overlaps SHF-0002 \(12:00–20:00\) for Avery on 2026-03-12/)
    expect(files.json('/shifts/SHF-0001').status).toBe('draft')
  })

  it('ignores drafts, other employees, other dates, archived shifts and back-to-back shifts', async () => {
    const files = memoryFiles({
      '/shifts/SHF-0001': shift(),
      '/shifts/SHF-0002': shift({ code: 'SHF-0002', status: 'draft' }),
      '/shifts/SHF-0003': shift({ code: 'SHF-0003', employee: 'Jordan', status: 'published', publishedAt: now }),
      '/shifts/SHF-0004': shift({ code: 'SHF-0004', date: '2026-03-13', status: 'confirmed', publishedAt: now, confirmedAt: now }),
      '/shifts/SHF-0005': shift({ code: 'SHF-0005', startTime: '16:00', endTime: '20:00', status: 'published', publishedAt: now }),
      '/shifts/SHF-0006': shift({ code: 'SHF-0006', state: 'archived', archivedAt: now, status: 'published', publishedAt: now }),
    })
    expect(await call(files, 'publish')).toMatchObject({ message: expect.stringContaining('Published SHF-0001') })
  })

  it('matches employees case-insensitively in the overlap check', async () => {
    const files = memoryFiles({
      '/shifts/SHF-0001': shift(),
      '/shifts/SHF-0002': shift({ code: 'SHF-0002', employee: ' avery ', status: 'confirmed', publishedAt: now, confirmedAt: now }),
    })
    await expect(call(files, 'publish')).rejects.toThrow(/overlaps/)
    expect(await findOverlap(files, shift({ employee: 'AVERY' }))).toMatchObject({ path: '/shifts/SHF-0002' })
  })

  it('confirms a published shift, idempotently, and refuses drafts', async () => {
    const files = memoryFiles({ '/shifts/SHF-0001': shift({ status: 'published', publishedAt: now }) })
    expect(await call(files, 'confirm')).toEqual({ message: 'Confirmed SHF-0001', path: '/shifts/SHF-0001' })
    expect(files.json('/shifts/SHF-0001')).toMatchObject({ status: 'confirmed', confirmedAt: now })
    expect(await call(files, 'confirm')).toMatchObject({ message: 'SHF-0001 is already confirmed' })
    expect(files.writes).toHaveLength(1)
    const draft = memoryFiles({ '/shifts/SHF-0001': shift() })
    await expect(call(draft, 'confirm')).rejects.toThrow(/only published shifts can be confirmed/)
  })

  it('refuses to publish a confirmed shift', async () => {
    const files = memoryFiles({ '/shifts/SHF-0001': shift({ status: 'confirmed', publishedAt: now, confirmedAt: now }) })
    await expect(call(files, 'publish')).rejects.toThrow(/only draft shifts can be published/)
  })

  it('refuses archived shifts and anything that is not a shift in /shifts', async () => {
    const files = memoryFiles({
      '/shifts/SHF-0001': shift({ state: 'archived', archivedAt: now }),
      '/shifts/odd': { kind: 'role', name: 'Not a shift' },
    })
    await expect(call(files, 'publish')).rejects.toThrow(/is archived/)
    await expect(call(files, 'publish', '/shifts/odd')).rejects.toThrow(/is not a shift/)
    await expect(call(files, 'publish', '/shifts/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'publish', '/shift-roles/PLR-0001')).rejects.toThrow(/directly in \/shifts/)
    await expect(call(files, 'cancel')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/shifts/SHF-0001': shift() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'publish')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/shifts/SHF-0001').status).toBe('draft')
  })
})
