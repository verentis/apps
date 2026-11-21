import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyDays, createRecord, weekdayCount } from '../scripts/create/main.mjs'
import { defaultSettings } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

const workspace = (extra = {}) => memoryFiles({ '/settings/time-off.json': defaultSettings, ...extra })

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.time-off.${kind}+json`,
  parentPath: kind === 'request' ? '/leave-requests' : '/leave-types', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Time Off create script', () => {
  it('creates a request with the default leave type and empty days until dates exist', async () => {
    const files = workspace()
    const result = await createRecord(input('request'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/leave-requests/TO-0001' })
    expect(files.json('/leave-requests/TO-0001')).toMatchObject({
      kind: 'request', code: 'TO-0001', employeeName: 'Example', status: 'draft',
      type: '/leave-types/LT-0001', startDate: '', endDate: '', days: '',
    })
  })

  it('counts the weekdays of a date range', () => {
    expect(weekdayCount('2026-03-02', '2026-03-06')).toBe(5)
    expect(weekdayCount('2026-03-06', '2026-03-09')).toBe(2)
    expect(weekdayCount('2026-03-07', '2026-03-08')).toBe(0)
    expect(weekdayCount('2026-03-04', '2026-03-04')).toBe(1)
    expect(weekdayCount('2026-03-06', '2026-03-02')).toBe(null)
    expect(weekdayCount('', '2026-03-06')).toBe(null)
    expect(weekdayCount('2026-03-02', 'soon')).toBe(null)
    expect(weekdayCount('2000-01-03', '2026-03-06')).toBe(null)
  })

  it('fills a request\'s empty days from its date range and keeps everything else', () => {
    expect(applyDays({ kind: 'request', days: '', startDate: '2026-03-02', endDate: '2026-03-10' }).days).toBe('7')
    expect(applyDays({ kind: 'request', days: '2.5', startDate: '2026-03-02', endDate: '2026-03-10' }).days).toBe('2.5')
    expect(applyDays({ kind: 'request', days: '', startDate: '', endDate: '2026-03-10' }).days).toBe('')
    expect(applyDays({ kind: 'type', startDate: '2026-03-02', endDate: '2026-03-10' }).days).toBeUndefined()
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('request'), undefined, files, { uuid })
    const result = await createRecord(input('request'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/leave-requests/TO-0002' })
  })

  it('creates a leave type that requires approval by default', async () => {
    const files = workspace()
    const result = await createRecord(input('type'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/leave-types/LT-0001' })
    expect(files.json('/leave-types/LT-0001')).toMatchObject({ kind: 'type', name: 'Example', daysPerYear: '', requiresApproval: true })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('request', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('TO-0001')
    expect(proposal.content.type).toBe('/leave-types/LT-0001')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('request', { creatable: 'holiday' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Time Off record type/)
  })
})
