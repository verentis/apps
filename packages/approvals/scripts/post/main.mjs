// Moves Approvals requests through their statuses. Canvas forms run this script (run-script) against a saved
// record; it checks the request's type (required fields, approver threshold), records each approver's decision and
// marks the request, with the file access its installer consented to (manifest `file-access`).
//
// Integrity model: records are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten; re-running an operation that already happened reports it instead of failing, so retries are
// idempotent. The same approver can only decide a request once; a single refusal decides it.
import { fail, nameOf, nowIso, readRecord, saveRecord } from './ledger.mjs'

export const operations = ['submit', 'approve', 'refuse', 'cancel']
export const approvals = {
  types: '/approval-types',
  requests: '/approval-requests',
  mime: kind => `application/vnd.verentis.approvals.${kind}+json`,
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const amountPattern = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This request'
const statusLabel = record => record.status || 'draft'

async function readRequest(files, path) {
  const request = await readRecord(files, checkPath(path, approvals.requests), 'request')
  if (request.record.state === 'archived') fail(`${label(request.record)} is archived. Restore it first.`)
  return request
}

/** The request's approval type: its required fields and how many distinct approvers it needs. */
async function readType(files, path) {
  if (!path) fail(`Choose the approval type from ${approvals.types} first.`)
  const { record } = await readRecord(files, checkPath(path, approvals.types), 'type')
  if (record.state === 'archived') fail(`Approval type ${record.name || nameOf(path)} is archived.`)
  const required = Number.isInteger(record.requiredApprovers) && record.requiredApprovers >= 1 ? record.requiredApprovers : 1
  return { ...record, requiredApprovers: required }
}

const entriesOf = record => Array.isArray(record.approvals) ? record.approvals : []
const approversOf = record => new Set(entriesOf(record).filter(entry => entry.decision === 'approve').map(entry => entry.approver))

export async function submitRequest(files, path, { now }) {
  const request = await readRequest(files, path)
  const { record } = request
  if (record.status === 'submitted') return { message: `${label(record)} is already submitted`, path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${statusLabel(record)} and can no longer be submitted.`)
  if (!String(record.title ?? '').trim()) fail('Give the request a title before submitting.')
  if (!String(record.requester ?? '').trim()) fail('Enter the requester\'s name before submitting.')
  if (!String(record.reason ?? '').trim()) fail('Give the reason for the request before submitting.')
  const type = await readType(files, record.type)
  if (type.requiresAmount && (!amountPattern.test(record.amount ?? '') || Number(record.amount) === 0)) {
    fail(`${type.name || 'This type'} requires a positive decimal amount, e.g. 1250.00.`)
  }
  if (type.requiresDate && !datePattern.test(record.date ?? '')) fail(`${type.name || 'This type'} requires the date (YYYY-MM-DD).`)
  if (type.requiresReference && !String(record.reference ?? '').trim()) fail(`${type.name || 'This type'} requires a reference.`)
  Object.assign(record, { status: 'submitted', submittedAt: now, approvals: entriesOf(record), updatedAt: now })
  await saveRecord(files, request, approvals.mime('request'))
  return { message: `Submitted ${label(record)} for approval (${type.requiredApprovers} approval${type.requiredApprovers === 1 ? '' : 's'} required)`, path }
}

export async function approveRequest(files, path, { approver, comment, now }) {
  const request = await readRequest(files, path)
  const { record } = request
  if (record.status === 'approved') return { message: `${label(record)} is already approved`, path }
  if (record.status !== 'submitted') fail(`${label(record)} is ${statusLabel(record)}. Submit it before approving.`)
  if (!approver) fail('Enter the approver\'s name.')
  const entries = entriesOf(record)
  if (entries.some(entry => entry.approver === approver)) {
    return { message: `${approver} has already decided on ${label(record)}`, path }
  }
  const type = await readType(files, record.type)
  entries.push({ approver, date: now, decision: 'approve', comment })
  const approved = approversOf({ approvals: entries }).size
  Object.assign(record, {
    approvals: entries, updatedAt: now,
    ...(approved >= type.requiredApprovers ? { status: 'approved', decidedAt: now } : {}),
  })
  await saveRecord(files, request, approvals.mime('request'))
  return record.status === 'approved'
    ? { message: `Approved ${label(record)} (${approved} of ${type.requiredApprovers})`, path }
    : { message: `${approver} approved ${label(record)} (${approved} of ${type.requiredApprovers})`, path }
}

export async function refuseRequest(files, path, { approver, comment, now }) {
  const request = await readRequest(files, path)
  const { record } = request
  if (record.status === 'refused') return { message: `${label(record)} is already refused`, path }
  if (record.status !== 'submitted') fail(`${label(record)} is ${statusLabel(record)}. Only submitted requests can be refused.`)
  if (!approver) fail('Enter the approver\'s name.')
  if (!comment) fail('Give the reason the request is refused in the Comment field.')
  const entries = entriesOf(record)
  if (entries.some(entry => entry.approver === approver)) {
    fail(`${approver} has already decided on ${label(record)}.`)
  }
  entries.push({ approver, date: now, decision: 'refuse', comment })
  Object.assign(record, { approvals: entries, status: 'refused', decidedAt: now, updatedAt: now })
  await saveRecord(files, request, approvals.mime('request'))
  return { message: `Refused ${label(record)}`, path }
}

export async function cancelRequest(files, path, { now }) {
  const request = await readRequest(files, path)
  const { record } = request
  if (record.status === 'cancelled') return { message: `${label(record)} is already cancelled`, path }
  if (record.status && record.status !== 'draft' && record.status !== 'submitted') {
    fail(`${label(record)} is ${statusLabel(record)} and can no longer be cancelled.`)
  }
  Object.assign(record, { status: 'cancelled', cancelledAt: now, updatedAt: now })
  await saveRecord(files, request, approvals.mime('request'))
  return { message: `Cancelled ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, approver, comment } = parameters ?? {}
  const options = {
    now,
    approver: typeof approver === 'string' ? approver.trim().slice(0, 200) : '',
    comment: typeof comment === 'string' ? comment.trim().slice(0, 1000) : '',
  }
  if (operation === 'submit') return submitRequest(files, path, options)
  if (operation === 'approve') return approveRequest(files, path, options)
  if (operation === 'refuse') return refuseRequest(files, path, options)
  if (operation === 'cancel') return cancelRequest(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
