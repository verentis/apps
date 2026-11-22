// Submits, approves, rejects and applies PLM engineering change orders. Canvas forms run this script
// (run-script) against a saved ECO; it enforces the review rules the files themselves cannot express (an
// approver before approving, a reason before rejecting), then writes with the file access its installer
// consented to (manifest `file-access`).
//
// Integrity model: ECOs are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten, and running an operation on an ECO already in the target stage reports instead of rewriting it.
import { fail, nowIso, readRecord, saveRecord } from './ledger.mjs'

export const operations = ['submit-review', 'approve', 'reject', 'apply']

export const plm = {
  ecos: '/engineering-change-orders',
  mime: 'application/vnd.verentis.plm.eco+json',
}

/** An ECO moves draft → in-review → approved → applied, or is rejected during review. */
const label = record => record.code || 'This change order'
const sameDate = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${plm.ecos}/`) || path.slice(plm.ecos.length + 1).includes('/')) {
    fail(`Expected a record directly in ${plm.ecos} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

async function readEco(files, path) {
  const eco = await readRecord(files, checkPath(path), 'eco')
  if (eco.record.state === 'archived') fail(`${label(eco.record)} is archived. Restore it first.`)
  return eco
}

export async function submitReview(files, path, { now }) {
  const eco = await readEco(files, path)
  const { record } = eco
  if (record.stage === 'in-review') return { message: `${label(record)} is already in review`, path }
  if (record.stage && record.stage !== 'draft') {
    fail(`${label(record)} is ${record.stage}. Only drafts can be submitted for review.`)
  }
  if (!String(record.title ?? '').trim()) fail('Give the change order a title before submitting it.')
  Object.assign(record, { stage: 'in-review', submittedAt: now, updatedAt: now })
  await saveRecord(files, eco, plm.mime)
  return { message: `Submitted ${label(record)} for review`, path }
}

export async function approve(files, path, { now }) {
  const eco = await readEco(files, path)
  const { record } = eco
  if (record.stage === 'approved' || record.stage === 'applied') return { message: `${label(record)} is already ${record.stage}`, path }
  if (record.stage !== 'in-review') fail(`${label(record)} is ${record.stage || 'draft'}. Submit it for review before approving.`)
  if (!String(record.approver ?? '').trim()) fail('Fill in the approver before approving.')
  Object.assign(record, { stage: 'approved', approvedAt: now, updatedAt: now })
  await saveRecord(files, eco, plm.mime)
  return { message: `Approved ${label(record)}`, path }
}

export async function reject(files, path, { now }) {
  const eco = await readEco(files, path)
  const { record } = eco
  if (record.stage === 'rejected') return { message: `${label(record)} is already rejected`, path }
  if (record.stage !== 'in-review') fail(`${label(record)} is ${record.stage || 'draft'}. Only changes in review can be rejected.`)
  if (!String(record.rejectionReason ?? '').trim()) fail('Fill in the rejection reason before rejecting.')
  Object.assign(record, { stage: 'rejected', rejectedAt: now, updatedAt: now })
  await saveRecord(files, eco, plm.mime)
  return { message: `Rejected ${label(record)}`, path }
}

export async function apply(files, path, { now }) {
  const eco = await readEco(files, path)
  const { record } = eco
  if (record.stage === 'applied') return { message: `${label(record)} is already applied`, path }
  if (record.stage !== 'approved') fail(`${label(record)} is ${record.stage || 'draft'}. Approve it before applying.`)
  const effectiveDate = sameDate.test(record.effectiveDate ?? '') ? record.effectiveDate : now.slice(0, 10)
  Object.assign(record, { stage: 'applied', effectiveDate, appliedAt: now, updatedAt: now })
  await saveRecord(files, eco, plm.mime)
  return { message: `Applied ${label(record)} · effective ${effectiveDate}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'submit-review') return submitReview(files, path, options)
  if (operation === 'approve') return approve(files, path, options)
  if (operation === 'reject') return reject(files, path, options)
  if (operation === 'apply') return apply(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
