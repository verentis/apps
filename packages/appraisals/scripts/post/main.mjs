// Schedules and completes Appraisals. The appraisal form runs this script (run-script) against a saved
// appraisal; it enforces the status transitions (draft → scheduled → done), requires non-empty ratings before
// completing, computes the overall score as the average rating (an exact decimal string, half-up to two
// decimals), and updates the appraisal conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten. Re-running a finished operation returns a friendly message instead of failing, so retries are safe.
export const operations = ['schedule', 'complete']
export const appraisals = {
  container: '/appraisals',
  mime: 'application/vnd.verentis.appraisals.appraisal+json',
}

class AppraisalError extends Error {}
export const fail = message => { throw new AppraisalError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This appraisal'
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${appraisals.container}/`) || path.slice(appraisals.container.length + 1).includes('/')) {
    fail(`Expected an appraisal directly in ${appraisals.container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** An appraisal with the ETag it was read at, so the update can be conditional. */
async function readAppraisal(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'appraisal') fail(`${path} is not an appraisal.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed appraisal back only if nobody changed it since it was read: a concurrent edit fails with
 * a conflict instead of being overwritten.
 */
async function saveAppraisal(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: appraisals.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The average rating in exact decimal text, rounded half-up to two decimals (never floats). */
export function overallScore(ratings) {
  if (!Array.isArray(ratings) || ratings.length === 0) fail('Add at least one rating before completing.')
  let total = 0
  ratings.forEach((rating, index) => {
    const at = `Rating ${index + 1}`
    if (!String(rating?.criteria ?? '').trim()) fail(`${at} needs its criteria.`)
    const score = Number(rating.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) fail(`${at} needs a score from 1 to 5.`)
    total += score
  })
  // Exact integer math: the score in hundredths, rounded half-up.
  const scaled = total * 100
  const hundredths = Math.trunc(scaled / ratings.length) + ((scaled % ratings.length) * 2 >= ratings.length ? 1 : 0)
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

/** draft → scheduled, on the appraisal's scheduled date (today when it is empty). */
export async function scheduleAppraisal(files, path, { now }) {
  const appraisal = await readAppraisal(files, path)
  const { record } = appraisal
  if (record.status === 'scheduled') return { message: `${label(record)} is already scheduled for ${record.scheduledAt}`, path }
  if (record.status !== 'draft') fail(`${label(record)} is ${record.status ?? 'in no status'}; only draft appraisals can be scheduled.`)
  const scheduledAt = datePattern.test(record.scheduledAt ?? '') ? record.scheduledAt : now.slice(0, 10)
  Object.assign(record, { status: 'scheduled', scheduledAt, updatedAt: now })
  await saveAppraisal(files, appraisal)
  return { message: `Scheduled ${label(record)} for ${scheduledAt}`, path }
}

/** scheduled → done, with the overall score computed from the ratings; the form locks a done appraisal. */
export async function completeAppraisal(files, path, { now }) {
  const appraisal = await readAppraisal(files, path)
  const { record } = appraisal
  if (record.status === 'done') return { message: `${label(record)} is already done with an overall score of ${record.overallScore}`, path }
  if (record.status !== 'scheduled') fail(`${label(record)} is ${record.status ?? 'in no status'}; only scheduled appraisals can be completed.`)
  const score = overallScore(record.ratings)
  Object.assign(record, { status: 'done', overallScore: score, completedAt: now, updatedAt: now })
  await saveAppraisal(files, appraisal)
  return { message: `Completed ${label(record)} with an overall score of ${score}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'schedule') return scheduleAppraisal(files, path, { now })
  if (operation === 'complete') return completeAppraisal(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
