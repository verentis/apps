// The Discuss action script: posts messages into threads and enforces the lifecycle transitions
// (open → resolved → locked, resolved → open, channel active → archived). Canvas forms run it (run-script)
// against a saved record. Discuss is the durable discussion record, not a realtime transport: this script
// appends to the trail; delivery and notifications are the platform's concern.
//
// Integrity model: records are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten. post-message takes an idempotency key stored on the appended message; a retried run finds its
// key already in the trail and returns a friendly message instead of appending twice. Re-running a finished
// transition likewise returns a friendly message, so retries are safe.
export const operations = ['post-message', 'resolve-thread', 'lock-thread', 'reopen-thread', 'archive-channel']
export const discuss = {
  channels: '/channels',
  threads: '/threads',
  channelMime: 'application/vnd.verentis.discuss.channel+json',
  threadMime: 'application/vnd.verentis.discuss.thread+json',
}

class DiscussError extends Error {}
export const fail = message => { throw new DiscussError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || `This ${record.kind}`

function checkPath(path, root, kind) {
  if (typeof path !== 'string' || !path.startsWith(`${root}/`) || path.slice(root.length + 1).includes('/')) {
    fail(`Expected a ${kind} directly in ${root} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A record with the ETag it was read at, so the update can be conditional. */
async function readRecord(files, path, root, kind) {
  const metadata = await files.stat(checkPath(path, root, kind))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== kind) fail(`${path} is not a ${kind}.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed record back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveRecord(files, { path, record, etag }, mime) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

const readThread = (files, path) => readRecord(files, path, discuss.threads, 'thread')
const saveThread = (files, thread) => saveRecord(files, thread, discuss.threadMime)

/** Fails unless the thread's channel exists and is an active (not archived) channel. */
async function checkChannel(files, record) {
  const path = record.channel
  if (!path) fail(`${label(record)} has no channel. Choose a channel and save the thread first.`)
  let channel
  try {
    channel = await files.readJson(path)
  } catch {
    fail(`The channel ${path} could not be read.`)
  }
  if (channel?.kind !== 'channel') fail(`${path} is not a channel.`)
  if (channel.status === 'archived' || channel.state === 'archived') {
    fail(`The channel ${channel.code || path} is archived and no longer accepts messages.`)
  }
}

/**
 * Appends `{ sequence, author, date, body }` to an open thread's trail and stamps `lastActivityAt`. The
 * idempotency key is stored on the message: a retry with the same key finds it and does not append again.
 */
export async function postMessage(files, path, { now, body, author, key }) {
  const thread = await readThread(files, path)
  const { record } = thread
  const messages = Array.isArray(record.messages) ? record.messages : []
  if (key && messages.some(message => message.key === key)) {
    return { message: `The message is already posted to ${label(record)}`, path }
  }
  if (record.status !== 'open') fail(`${label(record)} is ${record.status ?? 'in no status'}; only open threads accept messages.`)
  await checkChannel(files, record)
  const text = String(body || '').trim()
  if (!text) fail('Enter a message before posting.')
  const sequence = messages.reduce((highest, message) => Math.max(highest, Number(message.sequence) || 0), 0) + 1
  messages.push({ sequence, author: String(author || '').trim() || 'Anonymous', date: now, body: text, edited: false, ...(key ? { key } : {}) })
  Object.assign(record, { messages, draft: '', lastActivityAt: now, updatedAt: now })
  await saveThread(files, thread)
  return { message: `Posted message ${sequence} to ${label(record)}`, path }
}

/** open → resolved, stamping `resolvedAt`. */
export async function resolveThread(files, path, { now }) {
  const thread = await readThread(files, path)
  const { record } = thread
  if (record.status === 'resolved') return { message: `${label(record)} is already resolved`, path }
  if (record.status !== 'open') fail(`${label(record)} is ${record.status ?? 'in no status'}; only open threads can be resolved.`)
  Object.assign(record, { status: 'resolved', resolvedAt: now, updatedAt: now })
  await saveThread(files, thread)
  return { message: `Resolved ${label(record)}`, path }
}

/** resolved → locked, stamping `lockedAt`; the thread form locks itself once locked. */
export async function lockThread(files, path, { now }) {
  const thread = await readThread(files, path)
  const { record } = thread
  if (record.status === 'locked') return { message: `${label(record)} is already locked`, path }
  if (record.status !== 'resolved') fail(`${label(record)} is ${record.status ?? 'in no status'}; only resolved threads can be locked.`)
  Object.assign(record, { status: 'locked', lockedAt: now, updatedAt: now })
  await saveThread(files, thread)
  return { message: `Locked ${label(record)}`, path }
}

/** resolved → open, clearing the resolution stamp. Locked threads stay locked. */
export async function reopenThread(files, path, { now }) {
  const thread = await readThread(files, path)
  const { record } = thread
  if (record.status === 'open') return { message: `${label(record)} is already open`, path }
  if (record.status !== 'resolved') fail(`${label(record)} is ${record.status ?? 'in no status'}; only resolved threads can be reopened.`)
  delete record.resolvedAt
  Object.assign(record, { status: 'open', updatedAt: now })
  await saveThread(files, thread)
  return { message: `Reopened ${label(record)}`, path }
}

/** channel active → archived; archived channels reject new messages in their threads. */
export async function archiveChannel(files, path, { now }) {
  const channel = await readRecord(files, path, discuss.channels, 'channel')
  const { record } = channel
  if (record.status === 'archived') return { message: `${label(record)} is already archived`, path }
  Object.assign(record, { status: 'archived', updatedAt: now })
  await saveRecord(files, channel, discuss.channelMime)
  return { message: `Archived ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path, body, author, key } = parameters ?? {}
  const options = {
    now,
    body: typeof body === 'string' ? body.slice(0, 20000) : '',
    author: typeof author === 'string' ? author.slice(0, 200) : '',
    key: typeof key === 'string' && key ? key.slice(0, 128) : '',
  }
  if (operation === 'post-message') return postMessage(files, path, options)
  if (operation === 'resolve-thread') return resolveThread(files, path, options)
  if (operation === 'lock-thread') return lockThread(files, path, options)
  if (operation === 'reopen-thread') return reopenThread(files, path, options)
  if (operation === 'archive-channel') return archiveChannel(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
