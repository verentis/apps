// Schedules, publishes and cancels Social Marketing posts. Canvas post forms run this script (run-script)
// against a saved post; it enforces the status transitions (draft → scheduled → published, draft/scheduled →
// cancelled), checks the post's social account is active at publish, and updates the post conditionally
// (If-Match), so a concurrent edit fails instead of being overwritten. Re-running a finished operation returns a
// friendly message instead of failing, so retries are safe. Actual delivery to the social network's API is a
// platform integration concern: publishing here is a stage transition that stamps `publishedAt`.
export const operations = ['schedule', 'publish', 'cancel']
export const app = {
  posts: '/social-posts',
  accounts: '/social-accounts',
  mime: 'application/vnd.verentis.social-marketing.post+json',
}
/** The statuses a post can be published or cancelled from. */
export const publishableStatuses = ['draft', 'scheduled']

class SocialMarketingError extends Error {}
export const fail = message => { throw new SocialMarketingError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This post'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${app.posts}/`) || path.slice(app.posts.length + 1).includes('/')) {
    fail(`Expected a post directly in ${app.posts} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A post with the ETag it was read at, so the update can be conditional. */
async function readPost(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'post') fail(`${path} is not a post.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed post back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function savePost(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: app.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The post's social account, read at publish time; only active accounts publish. */
async function checkAccount(files, record) {
  const accountPath = String(record.account || '')
  if (!accountPath.startsWith(`${app.accounts}/`)) fail(`${label(record)} needs a social account in ${app.accounts} before it can be published.`)
  let account
  try {
    account = await files.readJson(accountPath)
  } catch {
    fail(`The social account ${accountPath} could not be read.`)
  }
  if (account?.kind !== 'account') fail(`${accountPath} is not a social account.`)
  if (account.state === 'archived') fail(`The social account ${accountPath} is archived. Restore it first.`)
  if (account.active !== true) fail(`The social account ${accountPath} is inactive. Activate it before publishing.`)
  return account
}

/** draft → scheduled, with the scheduled date already saved on the post. */
export async function schedulePost(files, path, { now }) {
  const post = await readPost(files, path)
  const { record } = post
  if (record.status === 'scheduled') return { message: `${label(record)} is already scheduled`, path }
  if (record.status !== 'draft') fail(`${label(record)} is ${record.status ?? 'in no status'}; only draft posts can be scheduled.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.scheduledDate || ''))) fail('Set the scheduled date before scheduling.')
  Object.assign(record, { status: 'scheduled', updatedAt: now })
  await savePost(files, post)
  return { message: `Scheduled ${label(record)} for ${record.scheduledDate}`, path }
}

/** draft/scheduled → published: checks the account is active, stamps `publishedAt` and locks the content. */
export async function publishPost(files, path, { now }) {
  const post = await readPost(files, path)
  const { record } = post
  if (record.status === 'published') return { message: `${label(record)} was already published`, path }
  if (!publishableStatuses.includes(record.status)) {
    fail(`${label(record)} is ${record.status ?? 'in no status'}; only ${publishableStatuses.join(' or ')} posts can be published.`)
  }
  if (!String(record.content || '').trim()) fail('Write the content before publishing.')
  const account = await checkAccount(files, record)
  Object.assign(record, { status: 'published', publishedAt: now, updatedAt: now })
  await savePost(files, post)
  return { message: `Published ${label(record)} as ${account.handle || record.account}`, path }
}

/** draft/scheduled → cancelled; published posts cannot be cancelled. */
export async function cancelPost(files, path, { now }) {
  const post = await readPost(files, path)
  const { record } = post
  if (record.status === 'cancelled') return { message: `${label(record)} is already cancelled`, path }
  if (!publishableStatuses.includes(record.status)) {
    fail(`${label(record)} is ${record.status ?? 'in no status'}; only ${publishableStatuses.join(' or ')} posts can be cancelled.`)
  }
  Object.assign(record, { status: 'cancelled', cancelledAt: now, updatedAt: now })
  await savePost(files, post)
  return { message: `Cancelled ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'schedule') return schedulePost(files, path, { now })
  if (operation === 'publish') return publishPost(files, path, { now })
  if (operation === 'cancel') return cancelPost(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
