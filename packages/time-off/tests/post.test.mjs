import { describe, expect, it } from 'vitest'
import { run, weekdayCount } from '../scripts/post/main.mjs'
import { starterTypes, templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const request = (values = {}) => ({
  ...templates.request, id: uuid(), createdAt: now, updatedAt: now, code: 'TO-0001',
  employeeName: 'Avery Adams', type: '/leave-types/LT-0001', startDate: '2026-03-02', endDate: '2026-03-06',
  days: '', reason: 'Family holiday', status: 'draft', ...values,
})
const workspace = (values = {}, extra = {}) => memoryFiles({
  ...Object.fromEntries(starterTypes.map(type => [`/leave-types/${type.code}`, type])),
  '/leave-requests/TO-0001': request(values),
  ...extra,
})
const call = (files, operation, path = '/leave-requests/TO-0001', extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Time Off request actions', () => {
  it('submits a draft, recomputing its days as the weekday count, idempotently', async () => {
    const files = workspace({ days: '99' })
    expect(await call(files, 'submit')).toEqual({ message: 'Submitted TO-0001 for 5 weekdays.', path: '/leave-requests/TO-0001' })
    expect(files.json('/leave-requests/TO-0001')).toMatchObject({
      status: 'submitted', days: '5', submittedAt: now, updatedAt: now,
    })
    expect(await call(files, 'submit')).toMatchObject({ message: 'TO-0001 is already submitted.' })
    expect(files.writes).toHaveLength(1)
  })

  it('approves on submission when the leave type does not require approval', async () => {
    const files = workspace({ type: '/leave-types/LT-0002', startDate: '2026-03-04', endDate: '2026-03-04' })
    expect((await call(files, 'submit')).message).toMatch(/Approved TO-0001 for 1 weekday: Sick leave does not require approval/)
    expect(files.json('/leave-requests/TO-0001')).toMatchObject({
      status: 'approved', days: '1', submittedAt: now, approver: 'Automatic (no approval required)', approvedAt: now,
    })
  })

  it('refuses to submit without an employee, a valid leave type or a usable date range', async () => {
    await expect(call(workspace({ employeeName: '  ' }), 'submit')).rejects.toThrow(/needs an employee name/)
    await expect(call(workspace({ type: '/elsewhere/LT-0001' }), 'submit')).rejects.toThrow(/leave type directly in \/leave-types/)
    await expect(call(workspace({ type: '/leave-types/LT-9999' }), 'submit')).rejects.toThrow(/no leave type at/)
    await expect(call(workspace({}, { '/leave-types/LT-0001': { kind: 'request' } }), 'submit')).rejects.toThrow(/not a leave type/)
    await expect(call(workspace({ endDate: '2026-03-01' }), 'submit')).rejects.toThrow(/valid date range/)
    await expect(call(workspace({ startDate: '2026-03-07', endDate: '2026-03-08' }), 'submit')).rejects.toThrow(/no weekdays/)
  })

  it('refuses to submit a decided request again', async () => {
    await expect(call(workspace({ status: 'approved', submittedAt: now, approver: 'J', approvedAt: now }), 'submit'))
      .rejects.toThrow(/already approved/)
    await expect(call(workspace({ status: 'refused', submittedAt: now, refusalReason: 'No', refusedAt: now }), 'submit'))
      .rejects.toThrow(/already refused/)
  })

  it('approves a submitted request with its approver, idempotently', async () => {
    const files = workspace({ status: 'submitted', submittedAt: now, days: '5' })
    expect(await call(files, 'approve', '/leave-requests/TO-0001', { approver: '  Jordan Jacobs  ' }))
      .toEqual({ message: 'Approved TO-0001.', path: '/leave-requests/TO-0001' })
    expect(files.json('/leave-requests/TO-0001')).toMatchObject({ status: 'approved', approver: 'Jordan Jacobs', approvedAt: now })
    expect(await call(files, 'approve')).toMatchObject({ message: 'TO-0001 is already approved.' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses invalid approval transitions and a missing approver', async () => {
    await expect(call(workspace(), 'approve', '/leave-requests/TO-0001', { approver: 'Jordan' }))
      .rejects.toThrow(/Submit it before approving/)
    await expect(call(workspace({ status: 'refused', submittedAt: now, refusalReason: 'No', refusedAt: now }), 'approve', '/leave-requests/TO-0001', { approver: 'Jordan' }))
      .rejects.toThrow(/refused request cannot be approved/)
    await expect(call(workspace({ status: 'submitted', submittedAt: now }), 'approve')).rejects.toThrow(/approver's name/)
  })

  it('refuses a submitted request with its reason, idempotently', async () => {
    const files = workspace({ status: 'submitted', submittedAt: now, days: '5' })
    expect(await call(files, 'refuse', '/leave-requests/TO-0001', { reason: 'No coverage that week.' }))
      .toEqual({ message: 'Refused TO-0001.', path: '/leave-requests/TO-0001' })
    expect(files.json('/leave-requests/TO-0001')).toMatchObject({ status: 'refused', refusalReason: 'No coverage that week.', refusedAt: now })
    expect(await call(files, 'refuse')).toMatchObject({ message: 'TO-0001 is already refused.' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses invalid refusal transitions and a missing reason', async () => {
    await expect(call(workspace(), 'refuse', '/leave-requests/TO-0001', { reason: 'No' })).rejects.toThrow(/Submit it before refusing/)
    await expect(call(workspace({ status: 'approved', submittedAt: now, approver: 'J', approvedAt: now }), 'refuse', '/leave-requests/TO-0001', { reason: 'No' }))
      .rejects.toThrow(/approved request cannot be refused/)
    await expect(call(workspace({ status: 'submitted', submittedAt: now }), 'refuse')).rejects.toThrow(/needs a reason/)
  })

  it('refuses archived requests and anything that is not a request in /leave-requests', async () => {
    const files = workspace({ state: 'archived' }, { '/leave-requests/odd': { kind: 'type', name: 'Not a request' } })
    await expect(call(files, 'submit')).rejects.toThrow(/is archived/)
    await expect(call(files, 'submit', '/leave-requests/odd')).rejects.toThrow(/not a leave request/)
    await expect(call(files, 'submit', '/leave-requests/missing')).rejects.toThrow(/no leave request at/)
    await expect(call(files, 'submit', '/leave-types/LT-0001')).rejects.toThrow(/directly in \/leave-requests/)
    await expect(call(files, 'escalate')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'submit')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/leave-requests/TO-0001').status).toBe('draft')
  })

  it('counts weekdays the same way the create script does', () => {
    expect(weekdayCount('2026-03-02', '2026-03-06')).toBe(5)
    expect(weekdayCount('2026-03-07', '2026-03-08')).toBe(0)
    expect(weekdayCount('2026-03-06', '2026-03-02')).toBe(null)
  })
})
