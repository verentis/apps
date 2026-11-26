// File-based Quality record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, decimal, fillTemplate, optional, pathOrEmpty, requires, schemas as schemaKit, text, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/quality'
export const schemaBase = 'https://schemas.verentis.io/quality/v1'

const vendor = kind => `application/vnd.verentis.quality.${kind}+json`

export const mimeTypes = {
  points: 'application/vnd.verentis.quality.points',
  checks: 'application/vnd.verentis.quality.checks',
  alerts: 'application/vnd.verentis.quality.alerts',
  point: vendor('point'),
  check: vendor('check'),
  alert: vendor('alert'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  points: { path: '/quality-control-points', mime: mimeTypes.points, holds: ['point'] },
  checks: { path: '/quality-checks', mime: mimeTypes.checks, holds: ['check'] },
  alerts: { path: '/quality-alerts', mime: mimeTypes.alerts, holds: ['alert'] },
}

/** Records are named by a generated code (`QCK-0001`) and stored without an extension in their container. */
export const recordKinds = ['point', 'check', 'alert']
export const containerOf = { point: 'points', check: 'checks', alert: 'alerts' }

export const codeSettings = {
  point: { key: 'point-code-prefix', default: 'QCP-', label: 'Control point code prefix' },
  check: { key: 'check-code-prefix', default: 'QCK-', label: 'Quality check code prefix' },
  alert: { key: 'alert-code-prefix', default: 'QAL-', label: 'Quality alert code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** A pass-fail point is judged by the operator; a measure point is judged against its tolerance. */
export const checkTypes = ['pass-fail', 'measure']
/** `pass` and `fail` are reached only through the record-check script action. */
export const results = ['pending', 'pass', 'fail']
export const severities = ['low', 'medium', 'high']
/** Alert stages. `resolved` is reached only through the resolve-alert script action. */
export const alertStages = ['new', 'investigation', 'action', 'resolved']
export const openAlertStages = ['new', 'investigation', 'action']

const { schemaId, recordSchema, recordTemplate } = schemaKit(schemaBase, 'Quality')
export { schemaId }

/** `if result is X then fields are required`. */
const whenResult = (values, fields) => ({
  if: { properties: { result: { enum: values } }, required: ['result'] },
  then: requires(fields),
})
/** `if stage is X then fields are required`. */
const whenStage = (values, fields) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then: requires(fields),
})

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
// Measure targets and tolerances are exact decimal strings ("12.5"), never JSON numbers; recording checks them.
export const schemas = {
  point: recordSchema('point', 'control point', {
    code,
    title: text,
    reference: optional(200),
    checkType: { enum: checkTypes },
    measureTarget: decimal,
    toleranceMin: decimal,
    toleranceMax: decimal,
    frequency: optional(200),
    active: { type: 'boolean' },
  }, ['code', 'title', 'reference', 'checkType', 'measureTarget', 'toleranceMin', 'toleranceMax', 'frequency', 'active']),
  check: recordSchema('check', 'quality check', {
    code,
    point: pathOrEmpty,
    date: { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' },
    reference: optional(200),
    result: { enum: results },
    measuredValue: decimal,
    notes: optional(10000),
    checkedAt: timestamp,
    alert: pathOrEmpty,
  }, ['code', 'point', 'date', 'reference', 'result', 'measuredValue', 'notes'], [
    whenResult(['pass', 'fail'], ['checkedAt']),
  ]),
  alert: recordSchema('alert', 'quality alert', {
    code,
    title: text,
    sourceCheck: pathOrEmpty,
    severity: { enum: severities },
    stage: { enum: alertStages },
    rootCause: optional(10000),
    correctiveAction: optional(10000),
    resolvedAt: timestamp,
  }, ['code', 'title', 'sourceCheck', 'severity', 'stage', 'rootCause', 'correctiveAction'], [
    whenStage(['resolved'], ['rootCause', 'correctiveAction', 'resolvedAt']),
  ]),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills an empty check date with today.
 */
export const templates = {
  point: recordTemplate('point', {
    title: '{{ name }}', reference: '', checkType: 'pass-fail',
    measureTarget: '', toleranceMin: '', toleranceMax: '', frequency: '', active: true,
  }),
  check: recordTemplate('check', {
    point: '', date: '', reference: '', result: 'pending', measuredValue: '', notes: '',
  }),
  alert: recordTemplate('alert', {
    title: '{{ name }}', sourceCheck: '', severity: 'medium', stage: 'new', rootCause: '', correctiveAction: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  check: { date: 'today' },
}

export { fillTemplate }
