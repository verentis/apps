// File-based Appointments record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, optional, optionalDate, optionalEmail, pathOrEmpty, schemas as schemaKit, text, timestamp,
  whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/appointments'
export const schemaBase = 'https://schemas.verentis.io/appointments/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the bookings.
export const settingsPath = '/settings/appointments.json'

const vendor = kind => `application/vnd.verentis.appointments.${kind}+json`

export const mimeTypes = {
  types: 'application/vnd.verentis.appointments.types',
  appointments: 'application/vnd.verentis.appointments.appointments',
  type: vendor('type'),
  appointment: vendor('appointment'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  types: { path: '/appointment-types', mime: mimeTypes.types, holds: ['type'] },
  appointments: { path: '/appointments', mime: mimeTypes.appointments, holds: ['appointment'] },
}

/** Records are named by a generated code (`APMT-0001`) and stored without an extension in their container. */
export const recordKinds = ['type', 'appointment']
export const containerOf = { type: 'types', appointment: 'appointments' }

export const codeSettings = {
  type: { key: 'type-code-prefix', default: 'APT-', label: 'Appointment type code prefix' },
  appointment: { key: 'appointment-code-prefix', default: 'APMT-', label: 'Appointment code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Appointment statuses. Everything after `booked` is reached only through the form's script actions. */
export const statuses = ['booked', 'confirmed', 'done', 'cancelled', 'no-show']
/** Statuses that still occupy the host's calendar; the confirm conflict check considers only these. */
export const activeStatuses = ['booked', 'confirmed']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Appointments')
export { schemaId }

/** A time of day (`08:30`), empty while a booking is incomplete. */
export const optionalTime = { type: 'string', pattern: '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' }

// Draft records may be incomplete on disk (a generated record opens straight into its form); confirming checks them.
export const schemas = {
  type: recordSchema('type', 'appointment type', {
    code,
    name: text,
    durationMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
    bufferMinutes: { type: 'integer', minimum: 0, maximum: 240 },
    host: optional(200),
    location: optional(500),
    active: { type: 'boolean' },
  }, ['code', 'name', 'durationMinutes', 'bufferMinutes', 'host', 'location', 'active']),
  appointment: recordSchema('appointment', 'appointment', {
    code,
    type: pathOrEmpty,
    guestName: optional(200),
    guestEmail: optionalEmail,
    date: optionalDate,
    startTime: optionalTime,
    endTime: optionalTime,
    host: optional(200),
    status: { enum: statuses },
    notes: optional(10000),
    confirmedAt: timestamp,
    completedAt: timestamp,
    cancelledAt: timestamp,
    noShowAt: timestamp,
  }, ['code', 'type', 'guestName', 'guestEmail', 'date', 'startTime', 'endTime', 'host', 'status', 'notes'], [
    whenStatus(['confirmed', 'done'], ['confirmedAt']),
    whenStatus(['done'], ['completedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
    whenStatus(['no-show'], ['noShowAt']),
  ]),
  settings: settingsSchema({
    defaultType: pathOrEmpty,
  }, ['defaultType']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code`, fills the date and the default type from the settings and schedules the end time and
 * host from the chosen type.
 */
export const templates = {
  type: recordTemplate('type', {
    name: '{{ name }}', durationMinutes: 30, bufferMinutes: 0, host: '', location: '', active: true,
  }),
  appointment: recordTemplate('appointment', {
    type: '', guestName: '{{ name }}', guestEmail: '', date: '', startTime: '', endTime: '', host: '',
    status: 'booked', notes: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  type: {},
  appointment: { date: 'today', type: { file: settingsPath, pointer: 'defaultType' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1,
  defaultType: '',
}

export { fillTemplate }
