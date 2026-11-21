// Records Quality checks and resolves Quality alerts. Canvas forms run this script (run-script) against a saved
// record; it enforces the result and stage transitions (pending → pass/fail, investigation/action → resolved),
// validates measured values against the control point's tolerance for measure checks, and raises a quality alert
// for every failed check.
//
// Integrity model: the raised alert gets a deterministic name (`/quality-alerts/QCK-0001-AL`) and is created
// create-only (If-None-Match: *), so a retried recording never raises twice; checks and alerts are updated
// conditionally (If-Match), so a concurrent edit fails instead of being overwritten. If a run stops between
// raising the alert and updating the check, running record-check again completes it.
import { randomUUID } from 'node:crypto'
import { fail, nameOf, nowIso, readRecord, saveRecord, statusOf, toMinor } from './ledger.mjs'

export const operations = ['record-check', 'resolve-alert']

export const quality = {
  points: '/quality-control-points',
  checks: '/quality-checks',
  alerts: '/quality-alerts',
  mime: kind => `application/vnd.verentis.quality.${kind}+json`,
  alertSchema: 'https://schemas.verentis.io/quality/v1/alert.schema.json',
}

/** The stages an alert can be resolved from: it must have been investigated first. */
export const resolvableStages = ['investigation', 'action']

/** Measured values and tolerances are exact decimal strings with at most six decimals, compared as BigInt millionths. */
const VALUE_DIGITS = 6
const toValue = (value, label) => toMinor(value, VALUE_DIGITS, label)

const label = record => record.code || 'This record'

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

/** The check's control point: it must be an active point directly in /quality-control-points. */
async function readPoint(files, reference) {
  if (!reference) fail(`Choose a control point from ${quality.points}.`)
  checkPath(reference, quality.points)
  let point
  try {
    point = await files.readJson(reference)
  } catch (error) {
    if (statusOf(error) === 404) fail(`Control point ${reference} does not exist.`)
    throw error
  }
  if (point?.kind !== 'point') fail(`${reference} is not a control point.`)
  if (point.state === 'archived') fail(`Control point ${point.code || reference} is archived. Restore it or choose an active one.`)
  if (point.active === false) fail(`Control point ${point.code || reference} is inactive. Activate it or choose an active one.`)
  return point
}

/**
 * The outcome tolerance dictates for a measured value: pass when it sits inside [toleranceMin, toleranceMax]
 * (either bound may be empty, but not both), fail otherwise.
 */
export function toleranceOutcome(point, measured, reference) {
  const name = point.code || reference
  const value = toValue(measured, 'Measured value')
  const min = String(point.toleranceMin ?? '').trim() ? toValue(point.toleranceMin, `Tolerance min of ${name}`) : null
  const max = String(point.toleranceMax ?? '').trim() ? toValue(point.toleranceMax, `Tolerance max of ${name}`) : null
  if (min === null && max === null) fail(`${name} has no tolerance. Set tolerance min or max before recording measure checks against it.`)
  const within = (min === null || value >= min) && (max === null || value <= max)
  const bounds = [min === null ? '' : `min ${point.toleranceMin}`, max === null ? '' : `max ${point.toleranceMax}`].filter(Boolean).join(', ')
  return { outcome: within ? 'pass' : 'fail', within, bounds }
}

/**
 * Raises the alert for a failed check create-only under its deterministic name. If an earlier, interrupted
 * attempt already wrote it (same `sourceCheck` pointing at the same check), the existing alert is kept:
 * retrying never raises twice.
 */
async function raiseAlert(files, path, alert) {
  try {
    await files.write(path, JSON.stringify(alert, null, 2), { contentType: quality.mime('alert'), ifNoneMatch: '*' })
    return
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(path)
  if (existing?.kind !== 'alert' || existing.sourceCheck !== alert.sourceCheck) {
    fail(`${path} already exists and belongs to something else. Rename it and try again.`)
  }
}

/**
 * pending → pass/fail. Pass-fail checks take the requested result; measure checks validate the measured value
 * against the control point's tolerance and refuse a result that contradicts it. A failing check raises a
 * quality alert, create-only, and links it on the check.
 */
export async function recordCheck(files, path, { now, uuid, result }) {
  const check = await readRecord(files, checkPath(path, quality.checks), 'check')
  const { record } = check
  checkActive(record)
  if (record.result === 'pass' || record.result === 'fail') return { message: `${label(record)} is already recorded as ${record.result}`, path }
  if (result !== 'pass' && result !== 'fail') fail(`Choose pass or fail (got ${JSON.stringify(result ?? '')}).`)
  const point = await readPoint(files, record.point)
  let outcome = result
  if (point.checkType === 'measure') {
    const measured = String(record.measuredValue ?? '').trim()
    if (!measured) fail('Enter the measured value before recording a measure check.')
    const tolerance = toleranceOutcome(point, measured, record.point)
    outcome = tolerance.outcome
    if (result !== outcome) {
      fail(`Measured value ${measured} is ${tolerance.within ? 'within' : 'outside'} tolerance (${tolerance.bounds}); record ${outcome} instead.`)
    }
  }
  Object.assign(record, { result: outcome, checkedAt: now, updatedAt: now })
  let raised = ''
  if (outcome === 'fail') {
    const name = `${record.code || nameOf(path)}-AL`
    const alertPath = `${quality.alerts}/${name}`
    await raiseAlert(files, alertPath, {
      $schema: quality.alertSchema, schemaVersion: 1, kind: 'alert', id: uuid(), state: 'active',
      createdAt: now, updatedAt: now, code: name,
      title: `Failed check ${record.code || nameOf(path)}${point.title ? ` · ${point.title}` : ''}`,
      sourceCheck: path, severity: 'high', stage: 'new', rootCause: '', correctiveAction: '',
    })
    record.alert = alertPath
    raised = ` and raised alert ${name}`
  }
  await saveRecord(files, check, quality.mime('check'))
  return { message: `Recorded ${outcome} for ${label(record)}${raised}`, path }
}

/** investigation/action → resolved, requiring the root cause and corrective action; the form locks resolved alerts. */
export async function resolveAlert(files, path, { now }) {
  const alert = await readRecord(files, checkPath(path, quality.alerts), 'alert')
  const { record } = alert
  checkActive(record)
  if (record.stage === 'resolved') return { message: `${label(record)} is already resolved`, path }
  if (!resolvableStages.includes(record.stage)) {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only ${resolvableStages.join(' or ')} alerts can be resolved.`)
  }
  const rootCause = String(record.rootCause ?? '').trim()
  if (!rootCause) fail('Enter the root cause before resolving.')
  const correctiveAction = String(record.correctiveAction ?? '').trim()
  if (!correctiveAction) fail('Enter the corrective action before resolving.')
  Object.assign(record, { stage: 'resolved', rootCause, correctiveAction, resolvedAt: now, updatedAt: now })
  await saveRecord(files, alert, quality.mime('alert'))
  return { message: `Resolved ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path, result } = parameters ?? {}
  if (operation === 'record-check') return recordCheck(files, path, { now, uuid, result })
  if (operation === 'resolve-alert') return resolveAlert(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
