// Moves Appointments bookings through their statuses. Canvas appointment forms run this script (run-script)
// against a saved appointment; it enforces the transitions (booked → confirmed → done, booked/confirmed →
// cancelled or no-show), completes the schedule from the appointment type when confirming (end time from the
// duration, host from the type), rejects a confirmation that would overlap the host's other booked or confirmed
// appointments (extended by the type's buffer), and updates the appointment conditionally (If-Match), so a
// concurrent edit fails instead of being overwritten. Re-running a finished operation returns a friendly message
// instead of failing, so retries are safe.
export const operations = ['confirm', 'complete', 'cancel', 'mark-no-show']
export const appointments = {
  appointments: '/appointments',
  mime: 'application/vnd.verentis.appointments.appointment+json',
}

class AppointmentsError extends Error {}
export const fail = message => { throw new AppointmentsError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This appointment'
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
/** Statuses that still occupy the host's calendar. */
const activeStatuses = ['booked', 'confirmed']

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${appointments.appointments}/`) || path.slice(appointments.appointments.length + 1).includes('/')) {
    fail(`Expected an appointment directly in ${appointments.appointments} (got ${JSON.stringify(path ?? '')}).`)
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

/** An appointment with the ETag it was read at, so the update can be conditional. */
async function readAppointment(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'appointment') fail(`${path} is not an appointment.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed appointment back only if nobody changed it since it was read: a concurrent edit fails with
 * a conflict instead of being overwritten.
 */
async function saveAppointment(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: appointments.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The appointment's type record, or undefined when none is chosen or it cannot be read. */
async function readType(files, record) {
  if (!record.type) return undefined
  try {
    const type = await files.readJson(record.type)
    return type?.kind === 'type' ? type : undefined
  } catch {
    return undefined
  }
}

/** `start` plus `minutes` as minutes-of-day arithmetic; the result may pass midnight for the overlap check. */
const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const toTime = total => `${String(Math.trunc(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

/**
 * Fills the appointment's empty end time (start plus the type's duration, left empty when it would pass
 * midnight) and empty host from its type.
 */
export function applySchedule(record, type) {
  if (!record.endTime && type && timePattern.test(record.startTime ?? '')) {
    const duration = Number(type.durationMinutes)
    if (Number.isInteger(duration) && duration > 0) {
      const total = toMinutes(record.startTime) + duration
      if (total < 24 * 60) record.endTime = toTime(total)
    }
  }
  if (!record.host && typeof type?.host === 'string') record.host = type.host
  return record
}

const sameHost = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/**
 * The first booked or confirmed appointment of the same host on the same date whose time range — extended by
 * `bufferMinutes` on both sides — overlaps the given appointment, or undefined. Half-open ranges: back-to-back
 * appointments without a buffer do not conflict.
 */
export async function findConflict(files, record, bufferMinutes = 0) {
  if (!String(record.host ?? '').trim()) return undefined
  const start = toMinutes(record.startTime) - bufferMinutes
  const end = toMinutes(record.endTime) + bufferMinutes
  // Each existing appointment also reserves its own type's buffer around it (cached per type file).
  const typeBuffers = new Map()
  const bufferOf = async other => {
    const typePath = typeof other.type === 'string' ? other.type : ''
    if (!typePath) return 0
    if (!typeBuffers.has(typePath)) {
      const buffer = Number((await readType(files, other))?.bufferMinutes)
      typeBuffers.set(typePath, Number.isInteger(buffer) && buffer > 0 ? buffer : 0)
    }
    return typeBuffers.get(typePath)
  }
  for (const child of await listFolder(files, appointments.appointments)) {
    if (child.mimeType && child.mimeType !== appointments.mime) continue
    let other
    try {
      other = await files.readJson(child.path)
    } catch {
      continue
    }
    if (other?.kind !== 'appointment' || other.id === record.id || other.state === 'archived') continue
    if (!activeStatuses.includes(other.status)) continue
    if (other.date !== record.date || !sameHost(other.host, record.host)) continue
    if (!timePattern.test(other.startTime ?? '') || !timePattern.test(other.endTime ?? '')) continue
    const otherBuffer = await bufferOf(other)
    if (start < toMinutes(other.endTime) + otherBuffer && toMinutes(other.startTime) - otherBuffer < end) return { path: child.path, record: other }
  }
  return undefined
}

/**
 * booked → confirmed, after completing the schedule from the type and checking the host's calendar for
 * conflicting booked or confirmed appointments.
 */
export async function confirmAppointment(files, path, { now }) {
  const appointment = await readAppointment(files, path)
  const { record } = appointment
  if (record.status === 'confirmed') return { message: `${label(record)} is already confirmed`, path }
  if (record.status !== 'booked') fail(`${label(record)} is ${record.status ?? 'in no status'}; only booked appointments can be confirmed.`)
  if (!datePattern.test(record.date ?? '')) fail(`${label(record)} needs a date (YYYY-MM-DD).`)
  if (!timePattern.test(record.startTime ?? '')) fail(`${label(record)} needs a start time (HH:MM).`)
  const type = await readType(files, record)
  applySchedule(record, type)
  if (!timePattern.test(record.endTime ?? '')) fail(`${label(record)} needs an end time (HH:MM). Choose a type or enter one.`)
  if (record.endTime <= record.startTime) fail(`${label(record)} must end after it starts (${record.startTime}–${record.endTime}).`)
  const buffer = Number(type?.bufferMinutes)
  const conflict = await findConflict(files, record, Number.isInteger(buffer) && buffer > 0 ? buffer : 0)
  if (conflict) {
    fail(`${label(record)} conflicts with ${conflict.record.code || conflict.path} (${conflict.record.startTime}–${conflict.record.endTime}) for ${record.host} on ${record.date}.`)
  }
  Object.assign(record, { status: 'confirmed', confirmedAt: now, updatedAt: now })
  await saveAppointment(files, appointment)
  return { message: `Confirmed ${label(record)} on ${record.date} at ${record.startTime}`, path }
}

/** confirmed → done; the appointment form locks itself once done. */
export async function completeAppointment(files, path, { now }) {
  const appointment = await readAppointment(files, path)
  const { record } = appointment
  if (record.status === 'done') return { message: `${label(record)} is already done`, path }
  if (record.status !== 'confirmed') fail(`${label(record)} is ${record.status ?? 'in no status'}; only confirmed appointments can be completed.`)
  Object.assign(record, { status: 'done', completedAt: now, updatedAt: now })
  await saveAppointment(files, appointment)
  return { message: `Completed ${label(record)}`, path }
}

/** booked or confirmed → cancelled. */
export async function cancelAppointment(files, path, { now }) {
  const appointment = await readAppointment(files, path)
  const { record } = appointment
  if (record.status === 'cancelled') return { message: `${label(record)} is already cancelled`, path }
  if (!activeStatuses.includes(record.status)) fail(`${label(record)} is ${record.status ?? 'in no status'}; only booked or confirmed appointments can be cancelled.`)
  Object.assign(record, { status: 'cancelled', cancelledAt: now, updatedAt: now })
  await saveAppointment(files, appointment)
  return { message: `Cancelled ${label(record)}`, path }
}

/** booked or confirmed → no-show. */
export async function markNoShow(files, path, { now }) {
  const appointment = await readAppointment(files, path)
  const { record } = appointment
  if (record.status === 'no-show') return { message: `${label(record)} is already marked as a no-show`, path }
  if (!activeStatuses.includes(record.status)) fail(`${label(record)} is ${record.status ?? 'in no status'}; only booked or confirmed appointments can be marked as a no-show.`)
  Object.assign(record, { status: 'no-show', noShowAt: now, updatedAt: now })
  await saveAppointment(files, appointment)
  return { message: `Marked ${label(record)} as a no-show`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'confirm') return confirmAppointment(files, path, { now })
  if (operation === 'complete') return completeAppointment(files, path, { now })
  if (operation === 'cancel') return cancelAppointment(files, path, { now })
  if (operation === 'mark-no-show') return markNoShow(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
