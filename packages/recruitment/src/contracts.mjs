// File-based Recruitment record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, money, optional, optionalEmail, pathOrEmpty, requires, schemas as schemaKit, text,
  timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/recruitment'
export const schemaBase = 'https://schemas.verentis.io/recruitment/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the data.
export const settingsPath = '/settings/recruitment.json'

const vendor = kind => `application/vnd.verentis.recruitment.${kind}+json`

export const mimeTypes = {
  jobs: 'application/vnd.verentis.recruitment.jobs',
  candidates: 'application/vnd.verentis.recruitment.candidates',
  job: vendor('job'),
  candidate: vendor('candidate'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  jobs: { path: '/job-positions', mime: mimeTypes.jobs, holds: ['job'] },
  candidates: { path: '/candidates', mime: mimeTypes.candidates, holds: ['candidate'] },
}

/** Records are named by a generated code (`JOB-0001`, `APP-0001`) and stored without an extension. */
export const recordKinds = ['job', 'candidate']
export const containerOf = { job: 'jobs', candidate: 'candidates' }

export const codeSettings = {
  job: { key: 'job-code-prefix', default: 'JOB-', label: 'Job position code prefix' },
  candidate: { key: 'candidate-code-prefix', default: 'APP-', label: 'Application number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

export const jobStatuses = ['open', 'on-hold', 'closed']
export const sources = ['website', 'referral', 'linkedin', 'email', 'agency', 'other']
/** Candidate stages. `hired` and `refused` are reached only through the hire and refuse script actions. */
export const stages = ['new', 'screening', 'interview', 'offer', 'hired', 'refused']
export const openStages = ['new', 'screening', 'interview', 'offer']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Recruitment')
export { schemaId }

/** `if stage is X then fields are required`. */
const whenStage = (values, fields) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then: requires(fields),
})

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  job: recordSchema('job', 'job position', {
    code,
    title: text,
    department: optional(200),
    status: { enum: jobStatuses },
    openings: { type: 'integer', minimum: 0, maximum: 1000 },
  }, ['code', 'title', 'status', 'openings']),
  candidate: recordSchema('candidate', 'candidate', {
    code,
    name: text,
    job: pathOrEmpty,
    email: optionalEmail,
    phone: optional(50),
    source: { enum: sources },
    stage: { enum: stages },
    expectedSalary: money,
    notes: optional(10000),
    refusalReason: optional(2000),
    hiredAt: timestamp,
  }, ['code', 'name', 'source', 'stage'], [
    whenStage(['refused'], ['refusalReason']),
    whenStage(['hired'], ['hiredAt']),
  ]),
  settings: settingsSchema({
    defaultJob: pathOrEmpty,
  }, ['defaultJob']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and defaults the candidate's job position from the Recruitment settings.
 */
export const templates = {
  job: recordTemplate('job', { title: '{{ name }}', department: '', status: 'open', openings: 1 }),
  candidate: recordTemplate('candidate', {
    name: '{{ name }}', job: '', email: '', phone: '', source: 'website', stage: 'new',
    expectedSalary: '', notes: '', refusalReason: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  job: {},
  candidate: { job: { file: settingsPath, pointer: 'defaultJob' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultJob: '',
}

export { fillTemplate }
