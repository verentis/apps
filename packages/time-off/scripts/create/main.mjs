// Creates a new Time Off record for the workspace "New" menu. Inside the app's containers the script writes the
// record itself, create-only, with the file access its installer consented to (manifest `file-access`), and returns
// `{ path }`; a taken name moves on to the next code. Elsewhere (a parent outside its grants, another branch, or a
// token without write access) it returns the `{ name, content }` proposal the workspace writes with the user's token.
//
// Beyond the shared proposal flow, leave requests get their `days` computed here: the weekday (Monday–Friday)
// count of the inclusive `startDate`–`endDate` range. Missing or invalid dates leave `days` empty; the request is
// still created, and submitting recomputes the count.
import config from './config.mjs'
import { propose } from './propose.mjs'

/** The containers this script declares `file-access: write` on (see manifest.yaml). */
export const writableRoots = config.writableRoots
export const attempts = 5

const lower = value => value.toLowerCase()
const within = path => writableRoots.some(root => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}/`))
const statusOf = error => error?.statusCode ?? error?.status
const datePattern = /^\d{4}-\d{2}-\d{2}$/

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
 * The number of weekdays (Monday–Friday) in the inclusive `start`–`end` range, or `null` when either date is
 * missing or invalid, the range is reversed, or it spans more than ten years.
 */
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

/** Fills a request's empty `days` with the weekday count of its date range; anything missing leaves it empty. */
export function applyDays(record) {
  if (record?.kind !== 'request' || record.days) return record
  const days = weekdayCount(record.startDate, record.endDate)
  if (days !== null) record.days = String(days)
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
    applyDays(proposal.content)
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
