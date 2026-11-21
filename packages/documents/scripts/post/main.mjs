// Moves Documents cards through the review workflow. Canvas document forms run this script (run-script) against a
// saved card; it enforces the status transitions (inbox → in-review → validated → archived-status, with in-review →
// inbox as the return path), stamps `validatedAt` on validation, and updates the card conditionally (If-Match), so
// a concurrent edit fails instead of being overwritten. Re-running a finished operation returns a friendly message
// instead of failing, so retries are safe. Only the card's metadata is written — the referenced VFS file is never
// touched.
export const operations = ['send-to-review', 'validate', 'archive', 'return-to-inbox']
export const documents = {
  cards: '/document-cards',
  mime: 'application/vnd.verentis.documents.document+json',
}

class DocumentsError extends Error {}
export const fail = message => { throw new DocumentsError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This document'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${documents.cards}/`) || path.slice(documents.cards.length + 1).includes('/')) {
    fail(`Expected a document card directly in ${documents.cards} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A document card with the ETag it was read at, so the update can be conditional. */
async function readCard(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'document') fail(`${path} is not a document card.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed card back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveCard(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: documents.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** inbox → in-review. */
export async function sendToReview(files, path, { now }) {
  const card = await readCard(files, path)
  const { record } = card
  if (record.status === 'in-review') return { message: `${label(record)} is already in review`, path }
  if (record.status !== 'inbox') fail(`${label(record)} is ${record.status ?? 'in no status'}; only inbox documents can be sent to review.`)
  Object.assign(record, { status: 'in-review', updatedAt: now })
  await saveCard(files, card)
  return { message: `Sent ${label(record)} to review`, path }
}

/** in-review → validated, stamping `validatedAt`; the document form locks itself once validated. */
export async function validate(files, path, { now }) {
  const card = await readCard(files, path)
  const { record } = card
  if (record.status === 'validated') return { message: `${label(record)} is already validated`, path }
  if (record.status !== 'in-review') fail(`${label(record)} is ${record.status ?? 'in no status'}; only documents in review can be validated.`)
  Object.assign(record, { status: 'validated', validatedAt: now, updatedAt: now })
  await saveCard(files, card)
  return { message: `Validated ${label(record)}`, path }
}

/** validated → archived-status; the card stays locked and keeps its validation stamp. */
export async function archive(files, path, { now }) {
  const card = await readCard(files, path)
  const { record } = card
  if (record.status === 'archived-status') return { message: `${label(record)} is already archived`, path }
  if (record.status !== 'validated') fail(`${label(record)} is ${record.status ?? 'in no status'}; only validated documents can be archived.`)
  Object.assign(record, { status: 'archived-status', updatedAt: now })
  await saveCard(files, card)
  return { message: `Archived ${label(record)}`, path }
}

/** in-review → inbox, with the review comment (a parameter or the card's reviewComment field). */
export async function returnToInbox(files, path, { now, comment }) {
  const card = await readCard(files, path)
  const { record } = card
  if (record.status === 'inbox') return { message: `${label(record)} is already in the inbox`, path }
  if (record.status !== 'in-review') fail(`${label(record)} is ${record.status ?? 'in no status'}; only documents in review can be returned to the inbox.`)
  const text = String(comment || record.reviewComment || '').trim()
  if (!text) fail('Enter the review comment before returning the document.')
  Object.assign(record, { status: 'inbox', reviewComment: text, updatedAt: now })
  await saveCard(files, card)
  return { message: `Returned ${label(record)} to the inbox`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, comment } = parameters ?? {}
  const options = { now, comment: typeof comment === 'string' ? comment.trim().slice(0, 2000) : '' }
  if (operation === 'send-to-review') return sendToReview(files, path, options)
  if (operation === 'validate') return validate(files, path, options)
  if (operation === 'archive') return archive(files, path, options)
  if (operation === 'return-to-inbox') return returnToInbox(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
