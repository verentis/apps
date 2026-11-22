// Publishes, archives and restores Knowledge articles. Canvas article forms run this script (run-script) against
// a saved article; it enforces the status transitions (draft → published → archived → draft), requires the title
// and the Markdown body before publishing, and updates the article conditionally (If-Match), so a concurrent edit
// fails instead of being overwritten. Re-running a finished operation returns a friendly message instead of
// failing, so retries are safe.
export const operations = ['publish', 'archive', 'restore']
export const knowledge = {
  articles: '/articles',
  mime: 'application/vnd.verentis.knowledge.article+json',
}

class KnowledgeError extends Error {}
export const fail = message => { throw new KnowledgeError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This article'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${knowledge.articles}/`) || path.slice(knowledge.articles.length + 1).includes('/')) {
    fail(`Expected an article directly in ${knowledge.articles} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** An article with the ETag it was read at, so the update can be conditional. */
async function readArticle(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'article') fail(`${path} is not an article.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed article back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveArticle(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: knowledge.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** draft → published; the title and the Markdown body must be filled in. */
export async function publishArticle(files, path, { now }) {
  const article = await readArticle(files, path)
  const { record } = article
  if (record.status === 'published') return { message: `${label(record)} is already published`, path }
  if (record.status !== 'draft') fail(`${label(record)} is ${record.status ?? 'in no status'}; only draft articles can be published. Restore it to draft first.`)
  if (!String(record.title || '').trim()) fail('Enter the title before publishing.')
  if (!String(record.body || '').trim()) fail('Write the article body before publishing.')
  Object.assign(record, { status: 'published', publishedAt: now, updatedAt: now })
  await saveArticle(files, article)
  return { message: `Published ${label(record)}`, path }
}

/** published → archived; the article form locks itself while archived. */
export async function archiveArticle(files, path, { now }) {
  const article = await readArticle(files, path)
  const { record } = article
  if (record.status === 'archived') return { message: `${label(record)} is already archived`, path }
  if (record.status !== 'published') fail(`${label(record)} is ${record.status ?? 'in no status'}; only published articles can be archived.`)
  Object.assign(record, { status: 'archived', updatedAt: now })
  await saveArticle(files, article)
  return { message: `Archived ${label(record)}`, path }
}

/** archived → draft, so the article can be edited and published again. */
export async function restoreArticle(files, path, { now }) {
  const article = await readArticle(files, path)
  const { record } = article
  if (record.status === 'draft') return { message: `${label(record)} is already a draft`, path }
  if (record.status !== 'archived') fail(`${label(record)} is ${record.status ?? 'in no status'}; only archived articles can be restored to draft.`)
  Object.assign(record, { status: 'draft', updatedAt: now })
  await saveArticle(files, article)
  return { message: `Restored ${label(record)} to draft`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'publish') return publishArticle(files, path, { now })
  if (operation === 'archive') return archiveArticle(files, path, { now })
  if (operation === 'restore') return restoreArticle(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
