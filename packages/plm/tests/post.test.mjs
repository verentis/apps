import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const eco = (values = {}) => ({
  ...templates.eco, id: options.uuid(), createdAt: now, updatedAt: now,
  code: 'ECO-0001', title: 'Thicker desk legs', product: '/bills-of-materials/BOM-0001', ...values,
})
const inReview = (values = {}) => eco({ stage: 'in-review', submittedAt: now, ...values })
const approved = (values = {}) => inReview({ stage: 'approved', approver: 'Ada Lovelace', approvedAt: now, ...values })

const shop = value => memoryFiles({ '/engineering-change-orders/ECO-0001': value })
const post = (files, operation, path = '/engineering-change-orders/ECO-0001') => run({ operation, path }, files, options)

describe('PLM review script', () => {
  it('submits a titled draft for review, idempotently', async () => {
    const files = shop(eco())
    expect(await post(files, 'submit-review')).toEqual({ message: 'Submitted ECO-0001 for review', path: '/engineering-change-orders/ECO-0001' })
    expect(files.json('/engineering-change-orders/ECO-0001')).toMatchObject({ stage: 'in-review', submittedAt: now, updatedAt: now })
    expect(await post(files, 'submit-review')).toMatchObject({ message: 'ECO-0001 is already in review' })
  })

  it('refuses to submit without a title', async () => {
    const files = shop(eco({ title: '  ' }))
    await expect(post(files, 'submit-review')).rejects.toThrow(/Give the change order a title/)
    expect(files.json('/engineering-change-orders/ECO-0001').stage).toBe('draft')
  })

  it('approves a change in review once the approver is filled in, idempotently', async () => {
    const files = shop(inReview({ approver: 'Ada Lovelace' }))
    expect(await post(files, 'approve')).toEqual({ message: 'Approved ECO-0001', path: '/engineering-change-orders/ECO-0001' })
    expect(files.json('/engineering-change-orders/ECO-0001')).toMatchObject({ stage: 'approved', approvedAt: now })
    expect(await post(files, 'approve')).toMatchObject({ message: 'ECO-0001 is already approved' })
  })

  it('refuses to approve without an approver', async () => {
    const files = shop(inReview())
    await expect(post(files, 'approve')).rejects.toThrow(/Fill in the approver before approving/)
    expect(files.json('/engineering-change-orders/ECO-0001').stage).toBe('in-review')
  })

  it('rejects a change in review only with a reason, idempotently', async () => {
    const files = shop(inReview())
    await expect(post(files, 'reject')).rejects.toThrow(/Fill in the rejection reason before rejecting/)
    files.nodes.get('/engineering-change-orders/ECO-0001').content = JSON.stringify(inReview({ rejectionReason: 'Too costly' }))
    expect(await post(files, 'reject')).toEqual({ message: 'Rejected ECO-0001', path: '/engineering-change-orders/ECO-0001' })
    expect(files.json('/engineering-change-orders/ECO-0001')).toMatchObject({ stage: 'rejected', rejectedAt: now, rejectionReason: 'Too costly' })
    expect(await post(files, 'reject')).toMatchObject({ message: 'ECO-0001 is already rejected' })
  })

  it('applies an approved change, keeping a valid effective date', async () => {
    const files = shop(approved({ effectiveDate: '2026-04-01' }))
    expect(await post(files, 'apply')).toEqual({ message: 'Applied ECO-0001 · effective 2026-04-01', path: '/engineering-change-orders/ECO-0001' })
    expect(files.json('/engineering-change-orders/ECO-0001')).toMatchObject({ stage: 'applied', appliedAt: now, effectiveDate: '2026-04-01' })
    expect(await post(files, 'apply')).toMatchObject({ message: 'ECO-0001 is already applied' })
  })

  it('stamps today as the effective date when none is set', async () => {
    const files = shop(approved({ effectiveDate: '' }))
    await post(files, 'apply')
    expect(files.json('/engineering-change-orders/ECO-0001').effectiveDate).toBe('2026-03-10')
  })

  it.each([
    ['approve a draft', eco(), 'approve', /ECO-0001 is draft\. Submit it for review before approving/],
    ['reject a draft', eco(), 'reject', /ECO-0001 is draft\. Only changes in review can be rejected/],
    ['apply an unapproved change', inReview(), 'apply', /ECO-0001 is in-review\. Approve it before applying/],
    ['submit an approved change', approved(), 'submit-review', /ECO-0001 is approved\. Only drafts can be submitted/],
    ['submit a rejected change', inReview({ stage: 'rejected', rejectedAt: now, rejectionReason: 'No' }), 'submit-review', /ECO-0001 is rejected\. Only drafts can be submitted/],
    ['apply a rejected change', inReview({ stage: 'rejected', rejectedAt: now, rejectionReason: 'No' }), 'apply', /ECO-0001 is rejected\. Approve it before applying/],
  ])('refuses to %s', async (_, value, operation, error) => {
    const files = shop(value)
    const before = files.json('/engineering-change-orders/ECO-0001').stage
    await expect(post(files, operation)).rejects.toThrow(error)
    expect(files.json('/engineering-change-orders/ECO-0001').stage).toBe(before)
  })

  it('refuses archived records, foreign paths and unknown operations', async () => {
    const files = shop(eco({ state: 'archived', archivedAt: now }))
    await expect(post(files, 'submit-review')).rejects.toThrow(/archived/)
    await expect(post(files, 'submit-review', '/elsewhere/ECO-0001')).rejects.toThrow(/directly in \/engineering-change-orders/)
    await expect(post(files, 'delete')).rejects.toThrow(/Unsupported operation/)
  })

  it('does not overwrite a change order edited while it was being posted', async () => {
    const files = shop(eco())
    const write = files.write
    files.write = async (...args) => { files.touch('/engineering-change-orders/ECO-0001'); return write(...args) }
    await expect(post(files, 'submit-review')).rejects.toThrow(/changed while it was being posted/)
  })
})
