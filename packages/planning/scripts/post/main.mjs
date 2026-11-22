// Publishes and confirms Planning shifts. Canvas shift forms run this script (run-script) against a saved shift;
// it enforces the status transitions (draft → published → confirmed), requires a complete schedule (date, start
// and end time with end after start, an employee) before publishing, rejects a publish that would overlap another
// published or confirmed shift of the same employee, and updates the shift conditionally (If-Match), so a
// concurrent edit fails instead of being overwritten. Re-running a finished operation returns a friendly message
// instead of failing, so retries are safe.
export const operations = ['publish', 'confirm']
export const planning = {
  shifts: '/shifts',
  mime: 'application/vnd.verentis.planning.shift+json',
}

class PlanningError extends Error {}
export const fail = message => { throw new PlanningError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This shift'
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${planning.shifts}/`) || path.slice(planning.shifts.length + 1).includes('/')) {
    fail(`Expected a shift directly in ${planning.shifts} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** All direct children of a folder, across list pages. */
async function listFolder(files, path) {
  const children = []
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const response = await files.list(path, 500, pageNo)
    const page = response?.children ?? response
    const items = Array.isArray(page) ? page : page?.data ?? []
    children.push(...items.map(item => ({ ...item, path: item.path ?? `${path}/${item.name}` })))
    const pageCount = Array.isArray(page) ? 1 : page?.pageCount ?? 1
    if (pageNo >= pageCount || items.length === 0) break
  }
  return children
}

/** A shift with the ETag it was read at, so the update can be conditional. */
async function readShift(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'shift') fail(`${path} is not a shift.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed shift back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveShift(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: planning.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The shift's schedule, checked: a date, HH:MM times and an end after the start. */
export function checkSchedule(record) {
  if (!datePattern.test(record.date ?? '')) fail(`${label(record)} needs a date (YYYY-MM-DD).`)
  if (!timePattern.test(record.startTime ?? '')) fail(`${label(record)} needs a start time (HH:MM).`)
  if (!timePattern.test(record.endTime ?? '')) fail(`${label(record)} needs an end time (HH:MM).`)
  if (record.endTime <= record.startTime) fail(`${label(record)} must end after it starts (${record.startTime}–${record.endTime}).`)
  if (!String(record.employee ?? '').trim()) fail(`${label(record)} needs an employee.`)
}

const sameEmployee = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/**
 * The first published or confirmed shift of the same employee on the same date whose time range overlaps the
 * given shift, or undefined. Half-open ranges: back-to-back shifts (08:00–12:00, 12:00–16:00) do not overlap.
 */
export async function findOverlap(files, record) {
  for (const child of await listFolder(files, planning.shifts)) {
    if (child.mimeType && child.mimeType !== planning.mime) continue
    let other
    try {
      other = await files.readJson(child.path)
    } catch {
      continue
    }
    if (other?.kind !== 'shift' || other.id === record.id || other.state === 'archived') continue
    if (!['published', 'confirmed'].includes(other.status)) continue
    if (other.date !== record.date || !sameEmployee(other.employee, record.employee)) continue
    if (record.startTime < other.endTime && other.startTime < record.endTime) return { path: child.path, record: other }
  }
  return undefined
}

/** draft → published, after the schedule check and the overlap check against the employee's published shifts. */
export async function publishShift(files, path, { now }) {
  const shift = await readShift(files, path)
  const { record } = shift
  if (record.status === 'published') return { message: `${label(record)} is already published`, path }
  if (record.status !== 'draft') fail(`${label(record)} is ${record.status ?? 'in no status'}; only draft shifts can be published.`)
  checkSchedule(record)
  const overlap = await findOverlap(files, record)
  if (overlap) {
    fail(`${label(record)} overlaps ${overlap.record.code || overlap.path} (${overlap.record.startTime}–${overlap.record.endTime}) for ${record.employee} on ${record.date}.`)
  }
  Object.assign(record, { status: 'published', publishedAt: now, updatedAt: now })
  await saveShift(files, shift)
  return { message: `Published ${label(record)} for ${record.employee} on ${record.date}`, path }
}

/** published → confirmed, after re-running the schedule and overlap checks (the shift may have been edited since publishing); the shift form locks itself once confirmed. */
export async function confirmShift(files, path, { now }) {
  const shift = await readShift(files, path)
  const { record } = shift
  if (record.status === 'confirmed') return { message: `${label(record)} is already confirmed`, path }
  if (record.status !== 'published') fail(`${label(record)} is ${record.status ?? 'in no status'}; only published shifts can be confirmed.`)
  checkSchedule(record)
  const overlap = await findOverlap(files, record)
  if (overlap) {
    fail(`${label(record)} overlaps ${overlap.record.code || overlap.path} (${overlap.record.startTime}–${overlap.record.endTime}) for ${record.employee} on ${record.date}.`)
  }
  Object.assign(record, { status: 'confirmed', confirmedAt: now, updatedAt: now })
  await saveShift(files, shift)
  return { message: `Confirmed ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'publish') return publishShift(files, path, { now })
  if (operation === 'confirm') return confirmShift(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
