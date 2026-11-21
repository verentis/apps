// Logs Fleet services and retires vehicles. Canvas forms run this script (run-script) against a saved record;
// it validates the fleet rules the files themselves cannot enforce (existing, non-retired vehicles and odometer
// readings that never go backwards), then writes with the file access its installer consented to (manifest
// `file-access`).
//
// Integrity model: records are updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten. The two writes of log-service (vehicle odometer, then the service log) are not one transaction:
// if a run stops after the vehicle update, re-running the operation passes the odometer check (the reading now
// equals the vehicle's odometer), skips the redundant vehicle write and completes the service log — re-runs are
// idempotent and never apply a reading twice. Already-done logs and already-retired vehicles return a friendly
// message instead of failing.
import { fail, formatMinor, nowIso, readRecord, saveRecord, toMinor } from './ledger.mjs'

export const operations = ['log-service', 'retire']

export const fleet = {
  vehicles: '/vehicles',
  contracts: '/fleet-contracts',
  services: '/service-logs',
  mime: kind => `application/vnd.verentis.fleet.${kind}+json`,
  schema: kind => `https://schemas.verentis.io/fleet/v1/${kind}.schema.json`,
}

/** Kilometres and costs are exact decimal strings with at most four decimal places, handled as BigInt ten-thousandths. */
const KM_DIGITS = 4
const toKm = (value, label) => toMinor(value, KM_DIGITS, label)
const formatKm = minor => minor % 10000n === 0n ? (minor / 10000n).toString() : formatMinor(minor, KM_DIGITS).replace(/0+$/, '')

const label = record => record.code || 'This record'
const sameDate = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** Reads the serviced vehicle (with its ETag) and checks it can take new work. */
async function readVehicle(files, path) {
  if (typeof path !== 'string' || !path.startsWith(`${fleet.vehicles}/`) || path.slice(fleet.vehicles.length + 1).includes('/')) {
    fail(`Choose a vehicle from ${fleet.vehicles} (got ${JSON.stringify(path ?? '')}).`)
  }
  const vehicle = await readRecord(files, path, 'vehicle')
  if (vehicle.record.state === 'archived') fail(`Vehicle ${label(vehicle.record)} is archived.`)
  return vehicle
}

export async function logService(files, path, { now }) {
  const service = await readRecord(files, checkPath(path, fleet.services), 'service')
  const { record } = service
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before logging.`)
  if (record.status === 'done') return { message: `${label(record)} is already done`, path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${record.status}.`)
  if (!record.vehicle) fail('Choose the vehicle that was serviced.')
  const vehicle = await readVehicle(files, record.vehicle)
  if (vehicle.record.status === 'retired') {
    fail(`Vehicle ${label(vehicle.record)} is retired. Services cannot be logged against it.`)
  }
  const reading = toKm(record.odometerKm, 'Odometer reading')
  const current = toKm(vehicle.record.odometerKm || '0', `Odometer of ${label(vehicle.record)}`)
  if (reading < current) {
    fail(`Odometer reading ${formatKm(reading)} km is behind ${label(vehicle.record)}'s current ${formatKm(current)} km. Readings cannot go backwards.`)
  }
  if (!sameDate.test(record.date ?? '')) fail('A service date (YYYY-MM-DD) is required.')
  if (record.cost) toKm(record.cost, 'Cost')
  // The vehicle is only written when the reading moves it forward, so a retried run skips the redundant write.
  if (reading > current) {
    Object.assign(vehicle.record, { odometerKm: formatKm(reading), updatedAt: now })
    await saveRecord(files, vehicle, fleet.mime('vehicle'))
  }
  Object.assign(record, { odometerKm: formatKm(reading), status: 'done', doneAt: now, updatedAt: now })
  await saveRecord(files, service, fleet.mime('service'))
  return { message: `Logged ${label(record)} at ${formatKm(reading)} km`, path }
}

export async function retire(files, path, { now }) {
  const vehicle = await readRecord(files, checkPath(path, fleet.vehicles), 'vehicle')
  const { record } = vehicle
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before retiring.`)
  if (record.status === 'retired') return { message: `${label(record)} is already retired`, path }
  if (record.status === 'in-maintenance') {
    fail(`${label(record)} is in maintenance. Set it back to active before retiring it.`)
  }
  if (record.status && record.status !== 'active') fail(`${label(record)} is ${record.status}.`)
  Object.assign(record, { status: 'retired', retiredAt: now, updatedAt: now })
  await saveRecord(files, vehicle, fleet.mime('vehicle'))
  return { message: `Retired ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'log-service') return logService(files, path, options)
  if (operation === 'retire') return retire(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
