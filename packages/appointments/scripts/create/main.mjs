// Creates a new Appointments record for the workspace "New" menu. Inside the app's containers the script writes
// the record itself, create-only, with the file access its installer consented to (manifest `file-access`), and
// returns `{ path }`; a taken name moves on to the next code. Elsewhere (a parent outside its grants, another
// branch, or a token without write access) it returns the `{ name, content }` proposal the workspace writes with
// the user's token.
//
// Beyond the shared proposal flow, new appointments get their schedule filled from their appointment type: an
// empty end time becomes the start time plus the type's duration, and an empty host is copied from the type. A
// missing or unreadable type leaves those fields empty; the appointment is still created.
import config from './config.mjs'
import { propose } from './propose.mjs'

/** The containers this script declares `file-access: write` on (see manifest.yaml). */
export const writableRoots = config.writableRoots
export const attempts = 5

const lower = value => value.toLowerCase()
const within = path => writableRoots.some(root => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}/`))
const statusOf = error => error?.statusCode ?? error?.status
const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

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

/** `start` plus `minutes`, or empty when the end would reach past the day. */
export function addMinutes(start, minutes) {
  const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + minutes
  if (total >= 24 * 60) return ''
  return `${String(Math.trunc(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Fills an appointment's empty `endTime` (start time plus the type's duration) and empty `host` from its
 * appointment type. Anything missing (no type chosen, type unreadable, no start time) leaves the fields empty.
 */
export async function applyTypeSchedule(record, files) {
  if (record?.kind !== 'appointment' || !record.type || !files) return record
  try {
    const type = await files.readJson(record.type)
    if (type?.kind !== 'type') return record
    const duration = Number(type.durationMinutes)
    if (!record.endTime && timePattern.test(record.startTime ?? '') && Number.isInteger(duration) && duration > 0) {
      record.endTime = addMinutes(record.startTime, duration)
    }
    if (!record.host && typeof type.host === 'string') record.host = type.host
  } catch {
    // The schedule is a convenience: the appointment is still created without it.
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
    await applyTypeSchedule(proposal.content, files)
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
