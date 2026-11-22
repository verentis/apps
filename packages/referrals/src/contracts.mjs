// File-based Referrals record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, optional, pathOrEmpty, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/referrals'
export const schemaBase = 'https://schemas.verentis.io/referrals/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the referrals.
export const settingsPath = '/settings/referrals.json'
/** Employees (optional) keeps employee records here; a referral can reference the referring employee. */
export const employees = {
  container: '/employees',
  employeeMime: 'application/vnd.verentis.employees.employee+json',
}
/** Recruitment (optional) keeps job positions here; a referral can link the position it is for. */
export const recruitment = {
  jobs: '/job-positions',
  jobMime: 'application/vnd.verentis.recruitment.job+json',
}

const vendor = kind => `application/vnd.verentis.referrals.${kind}+json`

export const mimeTypes = {
  referrals: 'application/vnd.verentis.referrals.referrals',
  referral: vendor('referral'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  referrals: { path: '/referrals', mime: mimeTypes.referrals, holds: ['referral'] },
}

/** Records are named by a generated code (`REF-0001`) and stored without an extension in their container. */
export const recordKinds = ['referral']
export const containerOf = { referral: 'referrals' }

export const codeSettings = {
  referral: { key: 'referral-code-prefix', default: 'REF-', label: 'Referral number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Referral statuses. The terminal `hired` and `not-hired` are reached only through the script actions. */
export const statuses = ['submitted', 'in-process', 'hired', 'not-hired']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Referrals')
export { schemaId }

const points = { type: 'integer', minimum: 0, maximum: 1000000 }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  referral: recordSchema('referral', 'referral', {
    code,
    referrerName: text,
    referrerRef: pathOrEmpty,
    candidateName: text,
    job: pathOrEmpty,
    status: { enum: statuses },
    points,
    notes: optional(10000),
    decidedAt: timestamp,
  }, ['code', 'referrerName', 'candidateName', 'status', 'points'], [
    whenStatus(['hired', 'not-hired'], ['decidedAt']),
  ]),
  settings: settingsSchema({
    hirePoints: { type: 'integer', minimum: 0, maximum: 100000 },
  }, ['hirePoints']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code`. `decidedAt` is stamped by the script actions, never by the template.
 */
export const templates = {
  referral: recordTemplate('referral', {
    referrerName: '{{ name }}', referrerRef: '', candidateName: '', job: '', status: 'submitted', points: 0, notes: '',
  }),
}

/** Defaults the create script fills into empty template fields (none: points start at 0). */
export const createDefaults = {}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, hirePoints: 100,
}

export { fillTemplate }
