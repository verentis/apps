// File-based Discuss record contracts. Every record is one JSON file whose vendor MIME names its kind.
// Discuss is the durable, auditable discussion record — channels and threaded messages as files — not a
// realtime chat transport: realtime delivery and notifications are a platform concern.
import {
  array, code, fillTemplate, object, optional, pathOrEmpty, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/discuss'
export const schemaBase = 'https://schemas.verentis.io/discuss/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the discussions.
export const settingsPath = '/settings/discuss.json'

const vendor = kind => `application/vnd.verentis.discuss.${kind}+json`

export const mimeTypes = {
  channels: 'application/vnd.verentis.discuss.channels',
  threads: 'application/vnd.verentis.discuss.threads',
  channel: vendor('channel'),
  thread: vendor('thread'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  channels: { path: '/channels', mime: mimeTypes.channels, holds: ['channel'] },
  threads: { path: '/threads', mime: mimeTypes.threads, holds: ['thread'] },
}

/** Records are named by a generated code (`CH-0001`) and stored without an extension in their container. */
export const recordKinds = ['channel', 'thread']
export const containerOf = { channel: 'channels', thread: 'threads' }

export const codeSettings = {
  channel: { key: 'channel-code-prefix', default: 'CH-', label: 'Channel code prefix' },
  thread: { key: 'thread-code-prefix', default: 'TH-', label: 'Thread code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const channelKinds = ['public', 'private']
/** `archived` is reached only through the archive-channel script action; archived channels reject new messages. */
export const channelStatuses = ['active', 'archived']
/** Thread lifecycle: open → resolved → locked, with resolved → open through the reopen action. */
export const threadStatuses = ['open', 'resolved', 'locked']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Discuss')
export { schemaId }

/** A UTC timestamp that may be empty while a thread has no activity yet. */
const optionalTimestamp = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z)?$' }

/**
 * One message in a thread's trail: an immutable, ordered record of who said what when. The body is Markdown.
 * `key` is the idempotency key the posting script stored it under, so a retried post never appends twice.
 */
const message = object({
  sequence: { type: 'integer', minimum: 1 },
  author: { type: 'string', maxLength: 200 },
  date: timestamp,
  body: { type: 'string', minLength: 1, maxLength: 20000 },
  edited: { type: 'boolean' },
  key: { type: 'string', maxLength: 128 },
}, ['sequence', 'author', 'date', 'body', 'edited'])

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  channel: recordSchema('channel', 'channel', {
    code,
    name: text,
    topic: optional(500),
    // The channel's Odoo-style kind (public or private); `visibility` because the envelope owns `kind`.
    visibility: { enum: channelKinds },
    members: array({ type: 'string', maxLength: 200 }, 0, 500),
    status: { enum: channelStatuses },
    createdBy: optional(200),
  }, ['code', 'name', 'visibility', 'members', 'status']),
  thread: recordSchema('thread', 'thread', {
    code,
    channel: pathOrEmpty,
    subject: text,
    startedBy: optional(200),
    status: { enum: threadStatuses },
    messages: array(message, 0, 1000),
    draft: optional(20000),
    postAs: optional(200),
    lastActivityAt: optionalTimestamp,
    resolvedAt: timestamp,
    lockedAt: timestamp,
  }, ['code', 'channel', 'subject', 'status', 'messages'], [
    whenStatus(['resolved', 'locked'], ['resolvedAt']),
    whenStatus(['locked'], ['lockedAt']),
  ]),
  settings: settingsSchema({
    defaultChannel: pathOrEmpty,
  }, ['defaultChannel']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the thread's channel from the Discuss settings.
 */
export const templates = {
  channel: recordTemplate('channel', {
    name: '{{ name }}', topic: '', visibility: 'public', members: [], status: 'active', createdBy: '',
  }),
  thread: recordTemplate('thread', {
    channel: '', subject: '{{ name }}', startedBy: '', status: 'open', messages: [], draft: '', postAs: '',
    lastActivityAt: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  channel: {},
  thread: { channel: { file: settingsPath, pointer: 'defaultChannel' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const seedChannelPath = `${containers.channels.path}/CH-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** A general channel and a welcome thread, seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('channel', 'CH-0001', '9e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a01', {
    name: 'General', topic: 'Company-wide announcements and discussion.', visibility: 'public',
    members: ['Avery Adams', 'Jordan Jacobs'], status: 'active', createdBy: 'Avery Adams',
  }),
  seedRecord('thread', 'TH-0001', '9e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a02', {
    channel: seedChannelPath, subject: 'Welcome to Discuss', startedBy: 'Avery Adams', status: 'open',
    messages: [{
      sequence: 1, author: 'Avery Adams', date: seedTime, edited: false,
      body: 'Welcome! Discuss keeps your team\'s conversations as **files**: channels hold threads, threads hold an auditable message trail. Post below to say hello.',
    }],
    draft: '', postAs: '', lastActivityAt: seedTime,
  }),
]
export const starterChannel = starterRecords[0]
export const starterThread = starterRecords[1]

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultChannel: seedChannelPath,
}

export { fillTemplate }
