// Terminates Employees records. The Canvas employee form runs this script (run-script) against a saved employee;
// it enforces the status transition (only active employees can be terminated), stamps the termination date and
// updates the employee conditionally (If-Match), so a concurrent edit fails instead of being overwritten.
// Re-running a finished operation returns a friendly message instead of failing, so retries are safe.
export const operations = ['terminate']
export const employees = {
  directory: '/employees',
  mime: 'application/vnd.verentis.employees.employee+json',
}

class EmployeesError extends Error {}
export const fail = message => { throw new EmployeesError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const label = record => record.code || 'This employee'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${employees.directory}/`) || path.slice(employees.directory.length + 1).includes('/')) {
    fail(`Expected an employee directly in ${employees.directory} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** An employee with the ETag it was read at, so the update can be conditional. */
async function readEmployee(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'employee') fail(`${path} is not an employee.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed employee back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveEmployee(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: employees.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** active → terminated, stamping the termination date (a parameter, or today). The form locks terminated employees. */
export async function terminateEmployee(files, path, { now, date }) {
  const employee = await readEmployee(files, path)
  const { record } = employee
  if (record.status === 'terminated') {
    return { message: `${label(record)} is already terminated (${record.terminationDate})`, path }
  }
  if (record.status !== 'active') {
    fail(`${label(record)} is ${record.status ?? 'in no status'}; only active employees can be terminated. Return them to active first.`)
  }
  const terminationDate = date || now.slice(0, 10)
  if (!datePattern.test(terminationDate)) fail(`${JSON.stringify(terminationDate)} is not a valid termination date (YYYY-MM-DD).`)
  if (datePattern.test(record.startDate ?? '') && terminationDate < record.startDate) {
    fail(`The termination date ${terminationDate} is before the start date ${record.startDate}.`)
  }
  Object.assign(record, { status: 'terminated', terminationDate, terminatedAt: now, updatedAt: now })
  await saveEmployee(files, employee)
  return { message: `Terminated ${label(record)} as of ${terminationDate}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, date } = parameters ?? {}
  const options = { now, date: typeof date === 'string' ? date.trim().slice(0, 10) : '' }
  if (operation === 'terminate') return terminateEmployee(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
