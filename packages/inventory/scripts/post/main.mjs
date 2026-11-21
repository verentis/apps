// Posts Inventory stock moves and applies inventory adjustments. Canvas forms run this script (run-script)
// against a saved record; it validates the stock rules the files themselves cannot enforce (existing products,
// warehouses and locations, positive quantities), then writes with the file access its installer consented to
// (manifest `file-access`).
//
// Integrity model: corrective moves get deterministic names (`/stock-moves/ADJ-0001`) and are created
// create-only, so a retried operation never writes twice; source records are updated conditionally (If-Match), so
// a concurrent edit fails instead of being overwritten. The steps are not one transaction: if a run stops between
// writing a corrective move and updating its adjustment, running the same operation again completes it. On-hand
// recomputation excludes the adjustment's own corrective move, so the retried delta is identical.
import { randomUUID } from 'node:crypto'
import { fail, formatMinor, nameOf, nowIso, readFolder, readRecord, saveRecord, statusOf, toMinor } from './ledger.mjs'

export const operations = ['post-move', 'apply-adjustment']

export const inventory = {
  products: '/products',
  warehouses: '/warehouses',
  moves: '/stock-moves',
  adjustments: '/inventory-adjustments',
  mime: kind => `application/vnd.verentis.inventory.${kind}+json`,
  schema: kind => `https://schemas.verentis.io/inventory/v1/${kind}.schema.json`,
}

/** Quantities are exact decimal strings with at most four decimal places, handled as BigInt ten-thousandths. */
const QTY_DIGITS = 4
const toQuantity = (value, label) => toMinor(value, QTY_DIGITS, label)
const formatQuantity = minor => minor % 10000n === 0n ? (minor / 10000n).toString() : formatMinor(minor, QTY_DIGITS).replace(/0+$/, '')

const label = record => record.code || 'This record'
const sameDate = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

async function readChild(files, path, container, kind) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Choose a ${kind} from ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (statusOf(error) === 404) fail(`${kind[0].toUpperCase()}${kind.slice(1)} ${path} does not exist.`)
    throw error
  }
  if (record?.kind !== kind) fail(`${path} is not a ${kind}.`)
  if (record.state === 'archived') fail(`${kind[0].toUpperCase()}${kind.slice(1)} ${record.code || path} is archived.`)
  return record
}

/** Reads a warehouse and checks that the given location (when set) is one of its declared locations. */
async function checkWarehouse(files, path, location, side) {
  const warehouse = await readChild(files, path, inventory.warehouses, 'warehouse')
  const where = String(location ?? '').trim()
  const locations = Array.isArray(warehouse.locations) ? warehouse.locations : []
  if (where && locations.length && !locations.includes(where)) {
    fail(`Warehouse ${warehouse.name || warehouse.code} has no ${side} location ${JSON.stringify(where)}. Its locations are: ${locations.join(', ')}.`)
  }
  return warehouse
}

function checkDate(record, what) {
  if (!sameDate.test(record.date ?? '')) fail(`A ${what} date (YYYY-MM-DD) is required.`)
}

/** Validates a move's product, warehouses, locations and quantity; returns the quantity in minor units. */
async function validateMove(files, record) {
  const quantity = toQuantity(record.quantity, 'Quantity')
  if (quantity <= 0n) fail('Enter a positive quantity before posting.')
  if (!record.product) fail('Choose the product being moved.')
  await readChild(files, record.product, inventory.products, 'product')
  if (!record.fromWarehouse && !record.toWarehouse) fail('Set the from or to warehouse: a move entirely outside the workspace changes nothing.')
  if (record.fromWarehouse && record.fromWarehouse === record.toWarehouse && (record.fromLocation || '') === (record.toLocation || '')) {
    fail('The move goes from a location to itself. Change the to warehouse or location.')
  }
  if (record.fromWarehouse) await checkWarehouse(files, record.fromWarehouse, record.fromLocation, 'from')
  if (record.toWarehouse) await checkWarehouse(files, record.toWarehouse, record.toLocation, 'to')
  checkDate(record, 'move')
  return quantity
}

export async function postMove(files, path, { now }) {
  const move = await readRecord(files, checkPath(path, inventory.moves), 'move')
  const { record } = move
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before posting.`)
  if (record.status === 'done') return { message: `${label(record)} is already done`, path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${record.status}.`)
  const quantity = await validateMove(files, record)
  Object.assign(record, { quantity: formatQuantity(quantity), status: 'done', postedAt: now, updatedAt: now })
  await saveRecord(files, move, inventory.mime('move'))
  return { message: `Posted ${label(record)}`, path }
}

/**
 * The on-hand quantity of a product at a warehouse location, from done moves. Moves emitted by `excludeSource`
 * (an adjustment being retried) are excluded, so an interrupted apply recomputes the same delta.
 */
export async function onHand(files, { product, warehouse, location, excludeSource }) {
  const where = String(location ?? '').trim()
  let total = 0n
  for (const { path, record } of await readFolder(files, inventory.moves, inventory.mime('move'), 'move')) {
    if (record.status !== 'done' || record.product !== product) continue
    if (excludeSource && record.source?.path === excludeSource) continue
    const quantity = toQuantity(record.quantity, `Quantity of ${record.code || path}`)
    if (record.toWarehouse === warehouse && String(record.toLocation ?? '').trim() === where) total += quantity
    if (record.fromWarehouse === warehouse && String(record.fromLocation ?? '').trim() === where) total -= quantity
  }
  return total
}

/**
 * Creates the corrective move create-only under its deterministic name. If an earlier, interrupted attempt
 * already wrote it (same `source` pointing at the same adjustment), the existing move is kept: retrying an
 * operation never writes twice.
 */
async function createMove(files, path, move) {
  try {
    await files.write(path, JSON.stringify(move, null, 2), { contentType: inventory.mime('move'), ifNoneMatch: '*' })
    return
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(path)
  if (existing?.kind !== 'move' || existing.source?.path !== move.source.path) {
    fail(`${path} already exists and belongs to something else. Rename it and try again.`)
  }
  const shape = value => JSON.stringify([value.product, value.quantity, value.fromWarehouse, value.fromLocation, value.toWarehouse, value.toLocation])
  if (shape(existing) !== shape(move)) {
    fail(`${path} was written by an earlier attempt with different details. Check it against ${move.source.path} before trying again.`)
  }
}

export async function applyAdjustment(files, path, { now, uuid }) {
  const adjustment = await readRecord(files, checkPath(path, inventory.adjustments), 'adjustment')
  const { record } = adjustment
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it before applying.`)
  if (record.status === 'applied') return { message: `${label(record)} is already applied`, path: record.move?.path ?? path }
  if (record.status && record.status !== 'draft') fail(`${label(record)} is ${record.status}.`)
  const counted = toQuantity(record.countedQty, 'Counted quantity')
  if (!record.product) fail('Choose the product being counted.')
  await readChild(files, record.product, inventory.products, 'product')
  if (!record.warehouse) fail('Choose the warehouse being counted.')
  await checkWarehouse(files, record.warehouse, record.location, 'counted')
  checkDate(record, 'count')
  const location = String(record.location ?? '').trim()
  const current = await onHand(files, { product: record.product, warehouse: record.warehouse, location, excludeSource: path })
  const delta = counted - current
  let movePath
  if (delta !== 0n) {
    movePath = `${inventory.moves}/${nameOf(path)}`
    const shortage = delta < 0n
    await createMove(files, movePath, {
      $schema: inventory.schema('move'), schemaVersion: 1, kind: 'move', id: uuid(), state: 'active',
      createdAt: now, updatedAt: now, code: nameOf(movePath),
      product: record.product, quantity: formatQuantity(shortage ? -delta : delta),
      fromWarehouse: shortage ? record.warehouse : '', fromLocation: shortage ? location : '',
      toWarehouse: shortage ? '' : record.warehouse, toLocation: shortage ? '' : location,
      date: record.date, reference: `Inventory adjustment ${label(record)}`,
      status: 'done', postedAt: now, source: { path },
    })
  }
  Object.assign(record, {
    countedQty: formatQuantity(counted), status: 'applied', appliedAt: now, updatedAt: now,
    ...(movePath ? { move: { path: movePath } } : {}),
  })
  await saveRecord(files, adjustment, inventory.mime('adjustment'))
  return movePath
    ? { message: `Applied ${label(record)} with ${nameOf(movePath)}`, path: movePath }
    : { message: `Applied ${label(record)}: the count matches the stock on hand`, path }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now, uuid }
  if (operation === 'post-move') return postMove(files, path, options)
  if (operation === 'apply-adjustment') return applyAdjustment(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
