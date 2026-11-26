// Validates Timesheets entries. The entry form runs this script (run-script) against a saved entry; it checks the
// entry is complete, the hours are a positive decimal and a linked Employees record is current, then marks it
// validated with the validation time.
//
// Integrity model: the entry is updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten, and validating an already-validated entry returns a friendly message instead of failing (idempotent).

export const operations = ['validate-entry']
export const timesheets = {
  entries: '/timesheets',
  entryMime: 'application/vnd.verentis.timesheets.entry+json',
}
/** Employees (optional): an entry may link the person's record there. */
export const employees = { directory: '/employees' }

class EntryError extends Error {}
const fail = message => { throw new EntryError(message) }
const statusOf = error => error?.statusCode ?? error?.status
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This entry'
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const hoursPattern = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${timesheets.entries}/`) || path.slice(timesheets.entries.length + 1).includes('/')) {
    fail(`Expected an entry directly in ${timesheets.entries} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A positive decimal-string number of hours; rejects numbers, zero, negatives and malformed text. */
export function checkHours(hours, record) {
  const text = typeof hours === 'string' ? hours.trim() : ''
  if (!hoursPattern.test(text)) fail(`${label(record)} needs hours as a positive decimal, e.g. 7.5 (got ${JSON.stringify(hours ?? '')}).`)
  if (!/[1-9]/.test(text)) fail(`${label(record)} has zero hours. Log the time worked before validating.`)
  return text
}

/** A linked Employees record must still exist and must not be terminated; an entry without a link is not checked. */
async function checkEmployee(files, record) {
  const ref = typeof record.employeeRef === 'string' ? record.employeeRef.trim() : ''
  if (!ref) return
  if (!ref.startsWith(`${employees.directory}/`) || ref.slice(employees.directory.length + 1).includes('/')) {
    fail(`${label(record)} links ${JSON.stringify(ref)}, which is not an Employees record. Choose the employee again.`)
  }
  let employee
  try {
    employee = (await files.stat(ref)) ? await files.readJson(ref) : null
  } catch (error) {
    if (!(error instanceof SyntaxError) && statusOf(error) !== 404) throw error
    employee = null
  }
  if (!employee) fail(`${label(record)} links an Employees record that no longer exists (${ref}). Choose the employee again.`)
  if (employee.status === 'terminated') fail(`${label(record)} is for ${employee.name || ref}, who is terminated in Employees.`)
}

/** The entry with the ETag it was read at, so the update can be conditional. */
async function readEntry(files, path) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'entry') fail(`${path} is not a timesheet entry.`)
  return { path, record, etag: metadata.etag }
}

/** Writes the changed entry back only if nobody changed it since it was read. */
async function saveEntry(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: timesheets.entryMime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being validated. Reload it and try again.`)
    throw error
  }
}

async function validateEntry(files, path, now) {
  const entry = await readEntry(files, checkPath(path))
  const { record } = entry
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  if (record.status === 'validated') return { message: `${label(record)} is already validated`, path }
  if (record.status !== 'draft') fail(`${label(record)} has an unexpected status ${JSON.stringify(record.status ?? '')}. Only drafts can be validated.`)
  if (!String(record.employee ?? '').trim()) fail(`${label(record)} needs an employee name.`)
  await checkEmployee(files, record)
  if (!datePattern.test(record.date ?? '')) fail(`${label(record)} needs a date (YYYY-MM-DD).`)
  record.hours = checkHours(record.hours, record)
  record.status = 'validated'
  record.validatedAt = now
  record.updatedAt = now
  await saveEntry(files, entry)
  return { message: `${label(record)} is validated`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'validate-entry') return validateEntry(files, path, now)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
