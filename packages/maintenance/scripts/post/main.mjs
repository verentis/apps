// Starts, completes and scraps Maintenance requests. Canvas request forms run this script (run-script) against a
// saved request; it enforces the stage transitions (new → in-progress → repaired, new/in-progress → scrap) and
// keeps the equipment status in sync: under maintenance while a request runs, operational when it is repaired,
// scrapped when the request scraps it.
//
// Integrity model: both records are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten. The two writes are not one transaction: the equipment is flipped first and the flip is idempotent
// (an already-flipped status is skipped), so a run interrupted between the equipment and the request write
// completes on retry. Re-running a finished operation returns a friendly message instead of failing.
import { fail, nowIso, readRecord, saveRecord } from './ledger.mjs'

export const operations = ['start-request', 'complete-request', 'scrap']

export const maintenance = {
  equipment: '/equipment',
  requests: '/maintenance-requests',
  mime: kind => `application/vnd.verentis.maintenance.${kind}+json`,
}

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

/** The request's equipment, with its ETag: it must be equipment directly in /equipment. */
async function readEquipment(files, reference) {
  if (!reference) fail(`Choose the equipment from ${maintenance.equipment}.`)
  const equipment = await readRecord(files, checkPath(reference, maintenance.equipment), 'equipment')
  checkActive(equipment.record)
  return equipment
}

/** Flips the equipment to `status` conditionally; an already-flipped status is skipped, so retries are safe. */
async function syncEquipment(files, equipment, status, now) {
  if (equipment.record.status === status) return
  Object.assign(equipment.record, { status, updatedAt: now })
  await saveRecord(files, equipment, maintenance.mime('equipment'))
}

/** new → in-progress; the equipment goes under maintenance. */
export async function startRequest(files, path, { now }) {
  const request = await readRecord(files, checkPath(path, maintenance.requests), 'request')
  const { record } = request
  checkActive(record)
  if (record.stage === 'in-progress') return { message: `${label(record)} is already in-progress`, path }
  if (record.stage !== 'new') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only new requests can be started.`)
  const equipment = await readEquipment(files, record.equipment)
  if (equipment.record.status === 'scrapped') fail(`${label(equipment.record)} is scrapped and cannot be maintained.`)
  await syncEquipment(files, equipment, 'under-maintenance', now)
  Object.assign(record, { stage: 'in-progress', startedAt: now, updatedAt: now })
  await saveRecord(files, request, maintenance.mime('request'))
  return { message: `Started ${label(record)} · ${label(equipment.record)} under maintenance`, path }
}

/** in-progress → repaired; the equipment returns to operational and the form locks the request. */
export async function completeRequest(files, path, { now }) {
  const request = await readRecord(files, checkPath(path, maintenance.requests), 'request')
  const { record } = request
  checkActive(record)
  if (record.stage === 'repaired') return { message: `${label(record)} is already repaired`, path }
  if (record.stage !== 'in-progress') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only in-progress requests can be completed.`)
  const equipment = await readEquipment(files, record.equipment)
  if (equipment.record.status === 'scrapped') fail(`${label(equipment.record)} is scrapped and cannot be repaired.`)
  await syncEquipment(files, equipment, 'operational', now)
  Object.assign(record, { stage: 'repaired', completedAt: now, updatedAt: now })
  await saveRecord(files, request, maintenance.mime('request'))
  return { message: `Completed ${label(record)} · ${label(equipment.record)} operational`, path }
}

/** new/in-progress → scrap; the equipment is scrapped and the form locks both records. */
export async function scrapRequest(files, path, { now }) {
  const request = await readRecord(files, checkPath(path, maintenance.requests), 'request')
  const { record } = request
  checkActive(record)
  if (record.stage === 'scrap') return { message: `${label(record)} is already scrapped`, path }
  if (record.stage !== 'new' && record.stage !== 'in-progress') {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only new or in-progress requests can scrap their equipment.`)
  }
  const equipment = await readEquipment(files, record.equipment)
  await syncEquipment(files, equipment, 'scrapped', now)
  Object.assign(record, { stage: 'scrap', scrappedAt: now, updatedAt: now })
  await saveRecord(files, request, maintenance.mime('request'))
  return { message: `Scrapped ${label(record)} · ${label(equipment.record)} scrapped`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'start-request') return startRequest(files, path, options)
  if (operation === 'complete-request') return completeRequest(files, path, options)
  if (operation === 'scrap') return scrapRequest(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
