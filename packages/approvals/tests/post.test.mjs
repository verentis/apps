import { describe, expect, it } from 'vitest'
import { containers, starterTypes, templates } from '../src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now }
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const record = (kind, values) => ({ ...templates[kind], id: uuid(), createdAt: now, updatedAt: now, ...values })
const typePath = code => `${containers.types.path}/${code}`
const requestPath = '/approval-requests/APR-0001'

function workspace(extra = {}) {
  return memoryFiles({
    ...Object.fromEntries(starterTypes.map(item => [typePath(item.code), item])),
    ...extra,
  })
}

// APT-0001 Purchase approval: 2 approvers, requires amount and date; APT-0002 Travel: 1 approver;
// APT-0003 Contract sign-off: 2 approvers, requires a reference.
const request = (values = {}) => record('request', {
  code: 'APR-0001', type: typePath('APT-0001'), title: 'Two standing desks', requester: 'Jo Soap',
  amount: '1250.00', date: '2026-03-03', reference: '', reason: 'The quote expires soon.',
  ...values,
})
const call = (files, operation, extra = {}, path = requestPath) => run({ operation, path, ...extra }, files, options)
const approve = (files, approver, comment = '') => call(files, 'approve', { approver, comment })

describe('Approvals decision script', () => {
  it('submits a draft and approves it once the type\'s distinct-approver threshold is reached', async () => {
    const files = workspace({ [requestPath]: request() })
    expect(await call(files, 'submit')).toMatchObject({ message: 'Submitted APR-0001 for approval (2 approvals required)' })
    expect(files.json(requestPath)).toMatchObject({ status: 'submitted', submittedAt: now })
    expect(await approve(files, 'Ana', 'Looks fine')).toMatchObject({ message: 'Ana approved APR-0001 (1 of 2)' })
    const once = files.json(requestPath)
    expect(once.status).toBe('submitted')
    expect(once.decidedAt).toBeUndefined()
    expect(once.approvals).toEqual([{ approver: 'Ana', date: now, decision: 'approve', comment: 'Looks fine' }])
    expect(await approve(files, 'Ben')).toMatchObject({ message: 'Approved APR-0001 (2 of 2)' })
    expect(files.json(requestPath)).toMatchObject({
      status: 'approved', decidedAt: now,
      approvals: [
        { approver: 'Ana', date: now, decision: 'approve', comment: 'Looks fine' },
        { approver: 'Ben', date: now, decision: 'approve', comment: '' },
      ],
    })
  })

  it('approves a single-approver type on the first approval', async () => {
    const files = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(files, 'submit')
    expect(await approve(files, 'Ana')).toMatchObject({ message: 'Approved APR-0001 (1 of 1)' })
    expect(files.json(requestPath)).toMatchObject({ status: 'approved', decidedAt: now })
  })

  it('rejects a second decision from the same approver without advancing the count', async () => {
    const files = workspace({ [requestPath]: request() })
    await call(files, 'submit')
    await approve(files, 'Ana')
    expect(await approve(files, 'Ana')).toMatchObject({ message: 'Ana has already decided on APR-0001' })
    const after = files.json(requestPath)
    expect(after.approvals).toHaveLength(1)
    expect(after.status).toBe('submitted')
    await expect(call(files, 'refuse', { approver: 'Ana', comment: 'Changed my mind' })).rejects.toThrow(/Ana has already decided on APR-0001/)
    expect(files.json(requestPath).status).toBe('submitted')
  })

  it('refuses on a single refusal with the comment, even after an approval', async () => {
    const files = workspace({ [requestPath]: request() })
    await call(files, 'submit')
    await approve(files, 'Ana')
    await expect(call(files, 'refuse', { approver: 'Ben' })).rejects.toThrow(/Give the reason/)
    expect(await call(files, 'refuse', { approver: 'Ben', comment: 'Over budget' })).toMatchObject({ message: 'Refused APR-0001' })
    expect(files.json(requestPath)).toMatchObject({
      status: 'refused', decidedAt: now,
      approvals: [
        { approver: 'Ana', decision: 'approve' },
        { approver: 'Ben', decision: 'refuse', comment: 'Over budget' },
      ],
    })
    await expect(approve(files, 'Cal')).rejects.toThrow(/is refused\. Submit it before approving/)
  })

  it('reports already-done operations instead of failing, so re-runs are idempotent', async () => {
    const files = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(files, 'submit')
    expect(await call(files, 'submit')).toMatchObject({ message: 'APR-0001 is already submitted' })
    await approve(files, 'Ana')
    const etag = files.nodes.get(requestPath).etag
    expect(await approve(files, 'Ben')).toMatchObject({ message: 'APR-0001 is already approved' })
    expect(files.nodes.get(requestPath).etag).toBe(etag)
    const refused = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(refused, 'submit')
    await call(refused, 'refuse', { approver: 'Ana', comment: 'No' })
    expect(await call(refused, 'refuse', { approver: 'Ben', comment: 'No' })).toMatchObject({ message: 'APR-0001 is already refused' })
    const cancelled = workspace({ [requestPath]: request() })
    await call(cancelled, 'cancel')
    expect(await call(cancelled, 'cancel')).toMatchObject({ message: 'APR-0001 is already cancelled' })
  })

  it('cancels draft and submitted requests but nothing decided', async () => {
    const draft = workspace({ [requestPath]: request() })
    expect(await call(draft, 'cancel')).toMatchObject({ message: 'Cancelled APR-0001' })
    expect(draft.json(requestPath)).toMatchObject({ status: 'cancelled', cancelledAt: now })
    const submitted = workspace({ [requestPath]: request() })
    await call(submitted, 'submit')
    expect(await call(submitted, 'cancel')).toMatchObject({ message: 'Cancelled APR-0001' })
    const approved = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(approved, 'submit')
    await approve(approved, 'Ana')
    await expect(call(approved, 'cancel')).rejects.toThrow(/is approved and can no longer be cancelled/)
    const refused = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(refused, 'submit')
    await call(refused, 'refuse', { approver: 'Ana', comment: 'No' })
    await expect(call(refused, 'cancel')).rejects.toThrow(/is refused and can no longer be cancelled/)
  })

  it.each([
    ['approve a draft', 'approve', { approver: 'Ana' }, /is draft\. Submit it before approving/],
    ['refuse a draft', 'refuse', { approver: 'Ana', comment: 'No' }, /is draft\. Only submitted requests can be refused/],
  ])('refuses to %s', async (_, operation, extra, error) => {
    const files = workspace({ [requestPath]: request() })
    await expect(call(files, operation, extra)).rejects.toThrow(error)
    expect(files.json(requestPath).status).toBe('draft')
  })

  it('refuses to resubmit or decide beyond the submitted status', async () => {
    const files = workspace({ [requestPath]: request({ type: typePath('APT-0002') }) })
    await call(files, 'submit')
    await approve(files, 'Ana')
    await expect(call(files, 'submit')).rejects.toThrow(/is approved and can no longer be submitted/)
    await expect(call(files, 'refuse', { approver: 'Ben', comment: 'Late' })).rejects.toThrow(/Only submitted requests can be refused/)
    const cancelled = workspace({ [requestPath]: request() })
    await call(cancelled, 'cancel')
    await expect(call(cancelled, 'submit')).rejects.toThrow(/is cancelled and can no longer be submitted/)
    await expect(approve(cancelled, 'Ana')).rejects.toThrow(/is cancelled\. Submit it before approving/)
  })

  it.each([
    ['no title', { title: ' ' }, /title before submitting/],
    ['no requester', { requester: '' }, /requester's name before submitting/],
    ['no reason', { reason: '' }, /reason for the request before submitting/],
    ['no type', { type: '' }, /Choose the approval type/],
    ['a missing amount its type requires', { amount: '' }, /requires a positive decimal amount/],
    ['a zero amount its type requires', { amount: '0' }, /requires a positive decimal amount/],
    ['a missing date its type requires', { date: '' }, /requires the date/],
  ])('refuses to submit a request with %s', async (_, values, error) => {
    const files = workspace({ [requestPath]: request(values) })
    await expect(call(files, 'submit')).rejects.toThrow(error)
    expect(files.json(requestPath).status).toBe('draft')
  })

  it('checks only the fields each type requires', async () => {
    const contract = workspace({ [requestPath]: request({ type: typePath('APT-0003'), amount: '', date: '', reference: '' }) })
    await expect(call(contract, 'submit')).rejects.toThrow(/Contract sign-off requires a reference/)
    const signed = workspace({ [requestPath]: request({ type: typePath('APT-0003'), amount: '', date: '', reference: 'MSA-2026-004' }) })
    expect(await call(signed, 'submit')).toMatchObject({ message: 'Submitted APR-0001 for approval (2 approvals required)' })
  })

  it('refuses to approve without an approver, and conflicts instead of overwriting a concurrent edit', async () => {
    const files = workspace({ [requestPath]: request() })
    await call(files, 'submit')
    await expect(approve(files, '  ')).rejects.toThrow(/approver's name/)
    const write = files.write
    files.write = async (path, ...args) => { files.touch(path); return write(path, ...args) }
    await expect(approve(files, 'Ana')).rejects.toThrow(/changed while it was being posted/)
    files.write = write
    expect(files.json(requestPath).approvals ?? []).toHaveLength(0)
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace({ [requestPath]: request() })
    await expect(call(files, 'email')).rejects.toThrow(/Unsupported operation/)
    await expect(run({ operation: 'submit', path: typePath('APT-0001') }, files, options)).rejects.toThrow(/directly in \/approval-requests/)
  })
})
