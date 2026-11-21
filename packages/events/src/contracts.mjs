// File-based Events record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, money, optional, optionalEmail, pathOrEmpty, schemas as schemaKit, text, timestamp,
  whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/events'
export const schemaBase = 'https://schemas.verentis.io/events/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the events.
export const settingsPath = '/settings/events.json'

const vendor = kind => `application/vnd.verentis.events.${kind}+json`

export const mimeTypes = {
  events: 'application/vnd.verentis.events.events',
  registrations: 'application/vnd.verentis.events.registrations',
  event: vendor('event'),
  registration: vendor('registration'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  events: { path: '/events', mime: mimeTypes.events, holds: ['event'] },
  registrations: { path: '/event-registrations', mime: mimeTypes.registrations, holds: ['registration'] },
}

/** Records are named by a generated code (`EVT-0001`) and stored without an extension in their container. */
export const recordKinds = ['event', 'registration']
export const containerOf = { event: 'events', registration: 'registrations' }

export const codeSettings = {
  event: { key: 'event-code-prefix', default: 'EVT-', label: 'Event code prefix' },
  registration: { key: 'registration-code-prefix', default: 'EVR-', label: 'Registration code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Event statuses. `published`, `done` and `cancelled` are reached only through the event action script. */
export const eventStatuses = ['draft', 'published', 'ongoing', 'done', 'cancelled']
/** The statuses an event accepts confirmations in. */
export const confirmableStatuses = ['published', 'ongoing']
/** Registration statuses. `confirmed`, `attended` and `cancelled` are set by the registration actions. */
export const registrationStatuses = ['draft', 'confirmed', 'attended', 'cancelled']
/** The registration statuses that count against an event's capacity. */
export const countedStatuses = ['confirmed', 'attended']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Events')
export { schemaId }

/** A UTC timestamp that may be empty while a draft is incomplete. */
const optionalTimestamp = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z)?$' }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  event: recordSchema('event', 'event', {
    code,
    name: text,
    venue: optional(200),
    onlineLink: optional(500),
    startsAt: optionalTimestamp,
    endsAt: optionalTimestamp,
    capacity: { type: 'integer', minimum: 0, maximum: 100000 },
    ticketPrice: money,
    status: { enum: eventStatuses },
    description: optional(10000),
    publishedAt: timestamp,
    completedAt: timestamp,
    cancelledAt: timestamp,
  }, ['code', 'name', 'venue', 'onlineLink', 'startsAt', 'endsAt', 'capacity', 'ticketPrice', 'status', 'description'], [
    whenStatus(['published', 'ongoing', 'done'], ['publishedAt']),
    whenStatus(['done'], ['completedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  registration: recordSchema('registration', 'registration', {
    code,
    event: pathOrEmpty,
    attendeeName: text,
    attendeeEmail: optionalEmail,
    qty: { type: 'integer', minimum: 1, maximum: 1000 },
    status: { enum: registrationStatuses },
    confirmedAt: timestamp,
  }, ['code', 'event', 'attendeeName', 'attendeeEmail', 'qty', 'status'], [
    whenStatus(countedStatuses, ['confirmedAt']),
  ]),
  settings: settingsSchema({
    defaultVenue: optional(200),
  }, ['defaultVenue']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the venue from the Events settings.
 */
export const templates = {
  event: recordTemplate('event', {
    name: '{{ name }}', venue: '', onlineLink: '', startsAt: '', endsAt: '', capacity: 50, ticketPrice: '',
    status: 'draft', description: '',
  }),
  registration: recordTemplate('registration', {
    event: '', attendeeName: '{{ name }}', attendeeEmail: '', qty: 1, status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  event: { venue: { file: settingsPath, pointer: 'defaultVenue' } },
  registration: {},
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultVenue: '',
}

export { fillTemplate }
