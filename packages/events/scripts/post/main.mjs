// Publishes, completes and cancels Events events, and confirms, checks in and cancels registrations. Canvas forms
// run this script (run-script) against a saved record; it enforces the status transitions (draft → published →
// ongoing → done, draft → confirmed → attended), validates capacity when confirming, and updates records
// conditionally (If-Match), so a concurrent edit fails instead of being overwritten. Re-running a finished
// operation returns a friendly message instead of failing, so retries are safe.
export const operations = ['publish', 'complete', 'cancel', 'confirm', 'check-in', 'cancel-registration']
export const events = {
  events: '/events',
  registrations: '/event-registrations',
  eventMime: 'application/vnd.verentis.events.event+json',
  registrationMime: 'application/vnd.verentis.events.registration+json',
}
/** The event statuses a registration can be confirmed in. */
export const confirmableStatuses = ['published', 'ongoing']
/** The event statuses an event can be cancelled from. */
export const cancellableStatuses = ['draft', 'published', 'ongoing']
/** The registration statuses that count against an event's capacity. */
export const countedStatuses = ['confirmed', 'attended']

class EventsError extends Error {}
export const fail = message => { throw new EventsError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = (record, fallback) => record.code || fallback

function checkPath(path, root, noun) {
  if (typeof path !== 'string' || !path.startsWith(`${root}/`) || path.slice(root.length + 1).includes('/')) {
    fail(`Expected ${noun} directly in ${root} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A record with the ETag it was read at, so the update can be conditional. */
async function readRecord(files, path, kind) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== kind) fail(`${path} is not ${kind === 'event' ? 'an event' : 'a registration'}.`)
  if (record.state === 'archived') fail(`${label(record, path)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

const readEvent = (files, path) => readRecord(files, checkPath(path, events.events, 'an event'), 'event')
const readRegistration = (files, path) => readRecord(files, checkPath(path, events.registrations, 'a registration'), 'registration')

/**
 * Writes the changed record back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveRecord(files, { path, record, etag }, mime) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

const saveEvent = (files, entry) => saveRecord(files, entry, events.eventMime)
const saveRegistration = (files, entry) => saveRecord(files, entry, events.registrationMime)

/** Every direct child of a folder, across list pages. */
async function listFolder(files, path) {
  const children = []
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const response = await files.list(path, 500, pageNo)
    const page = response?.children ?? response
    const items = Array.isArray(page) ? page : page?.data ?? []
    for (const item of items) {
      const name = item.name ?? (item.path ?? '').slice((item.path ?? '').lastIndexOf('/') + 1)
      children.push({ name, path: item.path ?? `${path.replace(/\/+$/, '')}/${name}` })
    }
    const pageCount = Array.isArray(page) ? 1 : page?.pageCount ?? 1
    if (pageNo >= pageCount || items.length === 0) break
  }
  return children
}

/** Seats already confirmed or attended against an event, excluding the registration being confirmed. */
export async function seatsTaken(files, eventPath, excludePath) {
  let taken = 0
  for (const child of await listFolder(files, events.registrations)) {
    if (child.path === excludePath) continue
    let sibling
    try {
      sibling = await files.readJson(child.path)
    } catch (error) {
      if (statusOf(error) === 404 || error instanceof SyntaxError) continue
      throw error
    }
    if (sibling?.kind !== 'registration' || sibling.state === 'archived') continue
    if (sibling.event !== eventPath || !countedStatuses.includes(sibling.status)) continue
    taken += Number.isInteger(sibling.qty) && sibling.qty > 0 ? sibling.qty : 0
  }
  return taken
}

/** draft → published, stamping `publishedAt`. A start time is required before an event goes public. */
export async function publishEvent(files, path, { now }) {
  const event = await readEvent(files, path)
  const { record } = event
  if (confirmableStatuses.includes(record.status)) return { message: `${label(record, path)} is already published`, path }
  if (record.status !== 'draft') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only draft events can be published.`)
  if (!record.startsAt) fail('Set the start time before publishing.')
  Object.assign(record, { status: 'published', publishedAt: now, updatedAt: now })
  await saveEvent(files, event)
  return { message: `Published ${label(record, path)}`, path }
}

/** published/ongoing → done, stamping `completedAt`. The form locks a done event. */
export async function completeEvent(files, path, { now }) {
  const event = await readEvent(files, path)
  const { record } = event
  if (record.status === 'done') return { message: `${label(record, path)} is already done`, path }
  if (!confirmableStatuses.includes(record.status)) {
    fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only ${confirmableStatuses.join(' or ')} events can be completed.`)
  }
  Object.assign(record, { status: 'done', completedAt: now, updatedAt: now })
  await saveEvent(files, event)
  return { message: `Completed ${label(record, path)}`, path }
}

/** draft/published/ongoing → cancelled, stamping `cancelledAt`. The form locks a cancelled event. */
export async function cancelEvent(files, path, { now }) {
  const event = await readEvent(files, path)
  const { record } = event
  if (record.status === 'cancelled') return { message: `${label(record, path)} is already cancelled`, path }
  if (!cancellableStatuses.includes(record.status)) {
    fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only ${cancellableStatuses.join(', ')} events can be cancelled.`)
  }
  Object.assign(record, { status: 'cancelled', cancelledAt: now, updatedAt: now })
  await saveEvent(files, event)
  return { message: `Cancelled ${label(record, path)}`, path }
}

/**
 * draft → confirmed, stamping `confirmedAt`. The event must be published or ongoing, and its remaining capacity
 * (capacity minus the seats other confirmed and attended registrations take) must cover this registration's seats.
 */
export async function confirmRegistration(files, path, { now }) {
  const registration = await readRegistration(files, path)
  const { record } = registration
  if (countedStatuses.includes(record.status)) return { message: `${label(record, path)} is already confirmed`, path }
  if (record.status !== 'draft') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only draft registrations can be confirmed.`)
  const qty = record.qty
  if (!Number.isInteger(qty) || qty < 1) fail('Set the number of seats (at least 1) before confirming.')
  if (!record.event) fail('Choose the event before confirming.')
  const { record: event } = await readEvent(files, record.event)
  if (!confirmableStatuses.includes(event.status)) {
    fail(`${label(event, record.event)} is ${event.status ?? 'in no status'}; registrations can only be confirmed on ${confirmableStatuses.join(' or ')} events.`)
  }
  const capacity = Number.isInteger(event.capacity) && event.capacity > 0 ? event.capacity : 0
  const taken = await seatsTaken(files, record.event, path)
  const remaining = capacity - taken
  if (remaining < qty) {
    fail(`${label(event, record.event)} has ${Math.max(remaining, 0)} of ${capacity} seats left; this registration needs ${qty}.`)
  }
  Object.assign(record, { status: 'confirmed', confirmedAt: now, updatedAt: now })
  await saveRegistration(files, registration)
  return { message: `Confirmed ${label(record, path)}`, path }
}

/** confirmed → attended. The form locks an attended registration. */
export async function checkInRegistration(files, path, { now }) {
  const registration = await readRegistration(files, path)
  const { record } = registration
  if (record.status === 'attended') return { message: `${label(record, path)} has already attended`, path }
  if (record.status !== 'confirmed') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only confirmed registrations can be checked in.`)
  Object.assign(record, { status: 'attended', updatedAt: now })
  await saveRegistration(files, registration)
  return { message: `Checked in ${label(record, path)}`, path }
}

/** draft/confirmed → cancelled, releasing the seats. Attended registrations stay on record. */
export async function cancelRegistration(files, path, { now }) {
  const registration = await readRegistration(files, path)
  const { record } = registration
  if (record.status === 'cancelled') return { message: `${label(record, path)} is already cancelled`, path }
  if (record.status === 'attended') fail(`${label(record, path)} has attended and can no longer be cancelled.`)
  Object.assign(record, { status: 'cancelled', updatedAt: now })
  await saveRegistration(files, registration)
  return { message: `Cancelled ${label(record, path)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'publish') return publishEvent(files, path, options)
  if (operation === 'complete') return completeEvent(files, path, options)
  if (operation === 'cancel') return cancelEvent(files, path, options)
  if (operation === 'confirm') return confirmRegistration(files, path, options)
  if (operation === 'check-in') return checkInRegistration(files, path, options)
  if (operation === 'cancel-registration') return cancelRegistration(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
