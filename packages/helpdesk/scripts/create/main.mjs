// Creates a new Helpdesk record for the workspace "New" menu. Inside the app's containers the script writes the
// record itself, create-only, with the file access its installer consented to (manifest `file-access`), and returns
// `{ path }`; a taken name moves on to the next code. Elsewhere (a parent outside its grants, another branch, or a
// token without write access) it returns the `{ name, content }` proposal the workspace writes with the user's token.
//
// Beyond the shared proposal flow, tickets get their SLA deadline computed here: the ticket's team (defaulted from
// the Helpdesk settings) names its SLA hours, and the deadline is `createdAt` plus those hours. A missing or
// unreadable team leaves the deadline empty; the ticket is still created.
import config from './config.mjs'
import { propose } from './propose.mjs'

/** The containers this script declares `file-access: write` on (see manifest.yaml). */
export const writableRoots = config.writableRoots
export const attempts = 5

const lower = value => value.toLowerCase()
const within = path => writableRoots.some(root => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}/`))
const statusOf = error => error?.statusCode ?? error?.status

/** Reads the settings files new records take defaults from; unreadable ones are skipped. */
export async function readDefaults(files) {
  const documents = {}
  for (const path of config.settingsFiles ?? []) {
    try {
      documents[path] = await files.readJson(path)
    } catch {
      // Defaults are a convenience: the form still opens with the template values.
    }
  }
  return documents
}

/**
 * Fills a ticket's empty `slaDeadline` from its team's `slaHours`, counted from the ticket's `createdAt`.
 * Anything missing (no team chosen, team unreadable, no valid hours) leaves the deadline empty.
 */
export async function applySlaDeadline(record, files) {
  if (record?.kind !== 'ticket' || record.slaDeadline || !record.team || !files) return record
  try {
    const team = await files.readJson(record.team)
    const hours = Number(team?.slaHours)
    const created = Date.parse(record.createdAt ?? '')
    if (team?.kind === 'team' && Number.isInteger(hours) && hours > 0 && Number.isFinite(created)) {
      record.slaDeadline = new Date(created + hours * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }
  } catch {
    // The deadline is a convenience: the ticket is still created without one.
  }
  return record
}

/**
 * Proposes the record and, when it falls inside a writable container on the files client's branch, creates it
 * create-only, retrying a taken name with the next proposal. `files` is the engine SDK files client.
 */
export async function createRecord(input, settings, files, { branch = 'main', uuid } = {}) {
  const siblings = Array.isArray(input?.siblings) ? [...input.siblings] : []
  const documents = files ? await readDefaults(files) : {}
  for (let attempt = 1; ; attempt++) {
    const proposal = propose({ ...input, siblings }, settings, uuid, documents)
    await applySlaDeadline(proposal.content, files)
    const parent = input.parentPath.replace(/\/+$/, '')
    const path = `${parent}/${proposal.name}`
    const sameBranch = (input.branch ?? branch).toLowerCase() === branch.toLowerCase()
    if (!files || !sameBranch || !within(path)) return proposal
    try {
      await files.write(path, JSON.stringify(proposal.content, null, 2), { contentType: input.mime || 'application/json', ifNoneMatch: '*' })
      return { path }
    } catch (error) {
      if (statusOf(error) === 403) return proposal
      if (statusOf(error) !== 412 || attempt >= attempts) throw error
      siblings.push(proposal.name)
    }
  }
}

export default async function create(engine) {
  const result = await createRecord(engine.context.input.parameters, engine.settings, engine.files,
    { branch: engine.context.file?.branch || 'main' })
  await engine.output.result(result)
}
