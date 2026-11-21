// Resolves and closes Helpdesk tickets. Canvas ticket forms run this script (run-script) against a saved ticket;
// it enforces the stage transitions (in-progress/waiting → solved → closed), requires the resolution text before
// resolving, and updates the ticket conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten. Re-running a finished operation returns a friendly message instead of failing, so retries are safe.
export const operations = ['resolve', 'close']
export const helpdesk = {
  tickets: '/tickets',
  mime: 'application/vnd.verentis.helpdesk.ticket+json',
}
/** The stages a ticket can be resolved from. */
export const resolvableStages = ['in-progress', 'waiting']

class HelpdeskError extends Error {}
export const fail = message => { throw new HelpdeskError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const nameOf = path => path.slice(path.lastIndexOf('/') + 1)
const label = record => record.code || 'This ticket'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${helpdesk.tickets}/`) || path.slice(helpdesk.tickets.length + 1).includes('/')) {
    fail(`Expected a ticket directly in ${helpdesk.tickets} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A ticket with the ETag it was read at, so the update can be conditional. */
async function readTicket(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'ticket') fail(`${path} is not a ticket.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed ticket back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveTicket(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: helpdesk.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** in-progress/waiting → solved, with the resolution text (a parameter or the ticket's resolution field). */
export async function resolveTicket(files, path, { now, resolution }) {
  const ticket = await readTicket(files, path)
  const { record } = ticket
  if (record.stage === 'solved') return { message: `${label(record)} is already solved`, path }
  if (!resolvableStages.includes(record.stage)) {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only ${resolvableStages.join(' or ')} tickets can be resolved.`)
  }
  const text = String(resolution || record.resolution || '').trim()
  if (!text) fail('Enter the resolution before resolving.')
  Object.assign(record, { stage: 'solved', resolution: text, resolvedAt: now, updatedAt: now })
  await saveTicket(files, ticket)
  return { message: `Resolved ${label(record)}`, path }
}

/** solved → closed; the ticket form locks itself once closed. */
export async function closeTicket(files, path, { now }) {
  const ticket = await readTicket(files, path)
  const { record } = ticket
  if (record.stage === 'closed') return { message: `${label(record)} is already closed`, path }
  if (record.stage !== 'solved') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only solved tickets can be closed.`)
  Object.assign(record, { stage: 'closed', closedAt: now, updatedAt: now })
  await saveTicket(files, ticket)
  return { message: `Closed ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, resolution } = parameters ?? {}
  const options = { now, resolution: typeof resolution === 'string' ? resolution.trim().slice(0, 10000) : '' }
  if (operation === 'resolve') return resolveTicket(files, path, options)
  if (operation === 'close') return closeTicket(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
