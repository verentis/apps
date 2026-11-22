// Decides Referrals. The referral form runs this script (run-script) against a saved referral; it enforces the
// status transitions (submitted/in-process → hired or not-hired), awards the points a hire earns from the
// Referrals settings, and updates the referral conditionally (If-Match), so a concurrent edit fails instead of
// being overwritten. Re-running a finished operation returns a friendly message instead of failing, so retries
// are safe.
export const operations = ['mark-hired', 'mark-not-hired']
export const referrals = {
  container: '/referrals',
  mime: 'application/vnd.verentis.referrals.referral+json',
}
export const settingsPath = '/settings/referrals.json'
export const defaultHirePoints = 100

class ReferralError extends Error {}
export const fail = message => { throw new ReferralError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This referral'
const open = ['submitted', 'in-process']

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${referrals.container}/`) || path.slice(referrals.container.length + 1).includes('/')) {
    fail(`Expected a referral directly in ${referrals.container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A referral with the ETag it was read at, so the update can be conditional. */
async function readReferral(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'referral') fail(`${path} is not a referral.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed referral back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveReferral(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: referrals.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The points a hire awards, from the Referrals settings; a missing or invalid value falls back to the default. */
export async function hirePoints(files) {
  let settings
  try {
    settings = await files.readJson(settingsPath)
  } catch {
    return defaultHirePoints
  }
  const points = settings?.hirePoints
  return Number.isInteger(points) && points >= 0 && points <= 100000 ? points : defaultHirePoints
}

/** submitted/in-process → hired, awarding the points from the settings; the form locks a decided referral. */
export async function markHired(files, path, { now }) {
  const referral = await readReferral(files, path)
  const { record } = referral
  if (record.status === 'hired') return { message: `${label(record)} is already hired (${record.points} points awarded)`, path }
  if (!open.includes(record.status)) fail(`${label(record)} is ${record.status ?? 'in no status'}; only submitted or in-process referrals can be marked hired.`)
  const points = await hirePoints(files)
  Object.assign(record, { status: 'hired', points, decidedAt: now, updatedAt: now })
  await saveReferral(files, referral)
  return { message: `Marked ${label(record)} hired and awarded ${points} points`, path }
}

/** submitted/in-process → not-hired; no points are awarded and the form locks a decided referral. */
export async function markNotHired(files, path, { now }) {
  const referral = await readReferral(files, path)
  const { record } = referral
  if (record.status === 'not-hired') return { message: `${label(record)} is already decided: not hired`, path }
  if (!open.includes(record.status)) fail(`${label(record)} is ${record.status ?? 'in no status'}; only submitted or in-process referrals can be marked not hired.`)
  Object.assign(record, { status: 'not-hired', decidedAt: now, updatedAt: now })
  await saveReferral(files, referral)
  return { message: `Marked ${label(record)} not hired`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'mark-hired') return markHired(files, path, { now })
  if (operation === 'mark-not-hired') return markNotHired(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
