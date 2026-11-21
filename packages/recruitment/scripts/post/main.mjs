// Advances, refuses and hires Recruitment candidates. Canvas candidate forms run this script (run-script)
// against a saved application; it enforces the stage transitions (new → screening → interview → offer, then
// Hire or Refuse), requires the refusal reason before refusing, and updates the candidate conditionally
// (If-Match), so a concurrent edit fails instead of being overwritten. Re-running a finished operation returns
// a friendly message instead of failing, so retries are safe.
export const operations = ['advance', 'refuse', 'hire']
export const recruitment = {
  candidates: '/candidates',
  mime: 'application/vnd.verentis.recruitment.candidate+json',
}
/** The ordered stages Advance walks; `hired` and `refused` are reached only through Hire and Refuse. */
export const advanceStages = ['new', 'screening', 'interview', 'offer']
/** The stages a candidate can be refused from. */
export const refusableStages = ['new', 'screening', 'interview', 'offer']

class RecruitmentError extends Error {}
export const fail = message => { throw new RecruitmentError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This candidate'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${recruitment.candidates}/`) || path.slice(recruitment.candidates.length + 1).includes('/')) {
    fail(`Expected a candidate directly in ${recruitment.candidates} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A candidate with the ETag it was read at, so the update can be conditional. */
async function readCandidate(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'candidate') fail(`${path} is not a candidate.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed candidate back only if nobody changed it since it was read: a concurrent edit fails with
 * a conflict instead of being overwritten.
 */
async function saveCandidate(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: recruitment.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** One step along new → screening → interview → offer; already at offer returns a friendly message. */
export async function advanceCandidate(files, path, { now }) {
  const candidate = await readCandidate(files, path)
  const { record } = candidate
  if (record.stage === 'offer') return { message: `${label(record)} is already at the offer stage. Use Hire or Refuse.`, path }
  const index = advanceStages.indexOf(record.stage)
  if (index === -1) {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only ${advanceStages.slice(0, -1).join(', ')} candidates can advance.`)
  }
  Object.assign(record, { stage: advanceStages[index + 1], updatedAt: now })
  await saveCandidate(files, candidate)
  return { message: `Moved ${label(record)} to ${record.stage}`, path }
}

/** Any open stage → refused, with the refusal reason (a parameter or the candidate's refusalReason field). */
export async function refuseCandidate(files, path, { now, reason }) {
  const candidate = await readCandidate(files, path)
  const { record } = candidate
  if (record.stage === 'refused') return { message: `${label(record)} is already refused`, path }
  if (!refusableStages.includes(record.stage)) {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only ${refusableStages.join(', ')} candidates can be refused.`)
  }
  const text = String(reason || record.refusalReason || '').trim()
  if (!text) fail('Enter the refusal reason before refusing.')
  Object.assign(record, { stage: 'refused', refusalReason: text, updatedAt: now })
  await saveCandidate(files, candidate)
  return { message: `Refused ${label(record)}`, path }
}

/** offer → hired; the candidate form locks itself once hired. */
export async function hireCandidate(files, path, { now }) {
  const candidate = await readCandidate(files, path)
  const { record } = candidate
  if (record.stage === 'hired') return { message: `${label(record)} is already hired`, path }
  if (record.stage !== 'offer') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only candidates at the offer stage can be hired.`)
  Object.assign(record, { stage: 'hired', hiredAt: now, updatedAt: now })
  await saveCandidate(files, candidate)
  return { message: `Hired ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, reason } = parameters ?? {}
  const options = { now, reason: typeof reason === 'string' ? reason.trim().slice(0, 2000) : '' }
  if (operation === 'advance') return advanceCandidate(files, path, options)
  if (operation === 'refuse') return refuseCandidate(files, path, options)
  if (operation === 'hire') return hireCandidate(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
