// Runs the Time Off request actions. Operation `submit` moves a draft leave request to submitted — validating the
// employee name, leave type and date range, recomputing `days` as the weekday count of the range — and approves it
// automatically when its leave type does not require approval. `approve` moves a submitted request to approved,
// recording the approver; `refuse` moves it to refused, recording the reason. Invalid transitions fail, repeating a
// finished action reports it instead, and saves are conditional so a concurrent edit fails rather than being lost.
//
// This script is self-contained on purpose: the installed copy under /applications/time-off/scripts must run
// without reaching outside its own directory.
const TYPES = '/leave-types'
const REQUESTS = '/leave-requests'
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export const operations = ['submit', 'approve', 'refuse']

const fail = message => {
  throw new Error(message)
}

const lower = value => value.toLowerCase()
const within = (path, root) => lower(path).startsWith(`${lower(root)}/`) && !path.slice(root.length + 1).includes('/')

/** The number of weekdays (Monday–Friday) in the inclusive `start`–`end` range, or `null` for an invalid range. */
export function weekdayCount(start, end) {
  if (!datePattern.test(start ?? '') || !datePattern.test(end ?? '')) return null
  const from = new Date(`${start}T00:00:00Z`)
  const to = new Date(`${end}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null
  if (to - from > 10 * 366 * 86400000) return null
  let days = 0
  for (const at = new Date(from); at <= to; at.setUTCDate(at.getUTCDate() + 1)) {
    const day = at.getUTCDay()
    if (day !== 0 && day !== 6) days += 1
  }
  return days
}

/** Reads the request the action runs on and fails with a human explanation when it is not actionable. */
async function readRequest(files, path) {
  if (!path) fail('This action needs the path of a leave request file.')
  if (!within(path, REQUESTS)) fail(`Leave requests live directly in ${REQUESTS}; ${path} is outside it.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if ((error?.statusCode ?? error?.status) === 404) fail(`There is no leave request at ${path}.`)
    throw error
  }
  if (record?.kind !== 'request') fail(`The file at ${path} is not a leave request.`)
  if (record.state === 'archived') fail('This leave request is archived. Restore it before acting on it.')
  return record
}

/** Saves `record` only when the file has not changed since it was read; a concurrent edit fails the action. */
async function save(files, path, record) {
  const { etag } = await files.stat(path)
  try {
    await files.write(path, JSON.stringify(record, null, 2), {
      contentType: 'application/vnd.verentis.time-off.request+json', ifMatch: etag,
    })
  } catch (error) {
    if ((error?.statusCode ?? error?.status) === 412) {
      fail('The leave request changed while it was being updated. Reload it and run the action again.')
    }
    throw error
  }
}

/**
 * Submits a draft request: validates its fields, recomputes `days` from the date range, and either marks it
 * submitted or — when its leave type does not require approval — approves it in the same step.
 */
export async function submit(files, path, now = nowIso()) {
  const record = await readRequest(files, path)
  if (record.status === 'submitted') return { message: `${record.code || path} is already submitted.`, path }
  if (record.status === 'approved' || record.status === 'refused') {
    fail(`${record.code || path} is already ${record.status}; a decided request cannot be submitted again.`)
  }
  if (!String(record.employeeName ?? '').trim()) fail('The request needs an employee name before it is submitted.')
  if (!within(record.type ?? '', TYPES)) fail(`The request needs a leave type directly in ${TYPES} before it is submitted.`)
  const days = weekdayCount(record.startDate, record.endDate)
  if (days === null) fail('The request needs a valid date range (first day on or before last day) before it is submitted.')
  if (days === 0) fail('The date range contains no weekdays; leave requests count Monday to Friday.')
  let type
  try {
    type = await files.readJson(record.type)
  } catch (error) {
    if ((error?.statusCode ?? error?.status) === 404) fail(`There is no leave type at ${record.type}.`)
    throw error
  }
  if (type?.kind !== 'type') fail(`The file at ${record.type} is not a leave type.`)
  record.days = String(days)
  record.status = 'submitted'
  record.submittedAt = now
  record.updatedAt = now
  let message = `Submitted ${record.code || path} for ${days} weekday${days === 1 ? '' : 's'}.`
  if (type.requiresApproval === false) {
    record.status = 'approved'
    record.approver = 'Automatic (no approval required)'
    record.approvedAt = now
    message = `Approved ${record.code || path} for ${days} weekday${days === 1 ? '' : 's'}: ${type.name || record.type} does not require approval.`
  }
  await save(files, path, record)
  return { message, path }
}

/** Approves a submitted request, recording who approved it. */
export async function approve(files, path, approver, now = nowIso()) {
  const record = await readRequest(files, path)
  if (record.status === 'approved') return { message: `${record.code || path} is already approved.`, path }
  if (record.status !== 'submitted') {
    fail(record.status === 'refused'
      ? `${record.code || path} is refused; a refused request cannot be approved.`
      : `${record.code || path} is a draft. Submit it before approving.`)
  }
  if (!String(approver ?? '').trim()) fail('Approving a request needs the approver\'s name.')
  record.status = 'approved'
  record.approver = String(approver).trim()
  record.approvedAt = now
  record.updatedAt = now
  await save(files, path, record)
  return { message: `Approved ${record.code || path}.`, path }
}

/** Refuses a submitted request, recording why. */
export async function refuse(files, path, reason, now = nowIso()) {
  const record = await readRequest(files, path)
  if (record.status === 'refused') return { message: `${record.code || path} is already refused.`, path }
  if (record.status !== 'submitted') {
    fail(record.status === 'approved'
      ? `${record.code || path} is approved; an approved request cannot be refused.`
      : `${record.code || path} is a draft. Submit it before refusing.`)
  }
  if (!String(reason ?? '').trim()) fail('Refusing a request needs a reason.')
  record.status = 'refused'
  record.refusalReason = String(reason).trim()
  record.refusedAt = now
  record.updatedAt = now
  await save(files, path, record)
  return { message: `Refused ${record.code || path}.`, path }
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, approver, reason } = parameters ?? {}
  if (operation === 'submit') return submit(files, path, now)
  if (operation === 'approve') return approve(files, path, approver, now)
  if (operation === 'refuse') return refuse(files, path, reason, now)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
