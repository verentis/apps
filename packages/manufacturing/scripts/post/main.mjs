// Confirms, starts and completes Manufacturing orders. Canvas forms run this script (run-script) against a saved
// order; it validates the production rules the files themselves cannot enforce (an active bill of materials,
// positive quantities), computes the exact component demand, then writes with the file access its installer
// consented to (manifest `file-access`).
//
// Integrity model: emitted stock moves get deterministic names (`/stock-moves/MO-0001-C1`, `/stock-moves/
// MO-0001-OUT`) and are created create-only, so a retried completion never writes twice; orders are updated
// conditionally (If-Match), so a concurrent edit fails instead of being overwritten. The steps are not one
// transaction: if a run stops between emitting the moves and updating the order, running the same operation
// again completes it.
import { randomUUID } from 'node:crypto'
import { divideHalfUp, fail, formatMinor, nameOf, nowIso, readRecord, saveRecord, statusOf, toMinor } from './ledger.mjs'

export const operations = ['confirm-mo', 'start-mo', 'complete-mo']

export const manufacturing = {
  boms: '/bills-of-materials',
  orders: '/manufacturing-orders',
  mime: kind => `application/vnd.verentis.manufacturing.${kind}+json`,
}

/** Inventory (optional): when its /stock-moves container exists, completing an order emits stock moves into it. */
export const inventory = {
  moves: '/stock-moves',
  settingsPath: '/settings/inventory.json',
  moveMime: 'application/vnd.verentis.inventory.move+json',
  moveSchema: 'https://schemas.verentis.io/inventory/v1/move.schema.json',
}

/** Quantities are exact decimal strings with at most four decimal places, handled as BigInt ten-thousandths. */
const QTY_DIGITS = 4
const SCALE = 10n ** BigInt(QTY_DIGITS)
const toQuantity = (value, label) => toMinor(value, QTY_DIGITS, label)
const formatQuantity = minor => minor % SCALE === 0n ? (minor / SCALE).toString() : formatMinor(minor, QTY_DIGITS).replace(/0+$/, '')

const label = record => record.code || 'This order'
const sameDate = /^\d{4}-\d{2}-\d{2}$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

/** The order's bill of materials: it must be an active BoM directly in /bills-of-materials. */
async function readBom(files, reference) {
  if (!reference) fail(`Choose a bill of materials from ${manufacturing.boms}.`)
  checkPath(reference, manufacturing.boms)
  let bom
  try {
    bom = await files.readJson(reference)
  } catch (error) {
    if (statusOf(error) === 404) fail(`Bill of materials ${reference} does not exist.`)
    throw error
  }
  if (bom?.kind !== 'bom') fail(`${reference} is not a bill of materials.`)
  if (bom.state === 'archived') fail(`Bill of materials ${bom.code || reference} is archived. Restore it or choose an active one.`)
  return bom
}

/**
 * The component demand of producing `quantity` with `bom`: each component's quantity scaled by
 * quantity ÷ the BoM output quantity, rounded half up to four decimal places.
 */
export function computeDemand(bom, quantity, reference) {
  const output = toQuantity(bom.outputQty, `The output quantity of ${bom.code || reference}`)
  if (output <= 0n) fail(`Set a positive output quantity on ${bom.code || reference} before confirming against it.`)
  const components = Array.isArray(bom.components) ? bom.components : []
  if (components.length === 0) fail(`${bom.code || reference} has no components. Add at least one before confirming against it.`)
  return components.map((component, index) => {
    const at = `Component ${index + 1} of ${bom.code || reference}`
    if (!String(component.product ?? '').trim()) fail(`${at} has no product.`)
    const per = toQuantity(component.quantity, `${at} quantity`)
    if (per <= 0n) fail(`${at} needs a positive quantity.`)
    return {
      product: component.product,
      name: String(component.name ?? ''),
      quantity: formatQuantity(divideHalfUp(per * quantity, output)),
    }
  })
}

export async function confirmOrder(files, path, { now }) {
  const order = await readRecord(files, checkPath(path, manufacturing.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'confirmed' || record.status === 'in-progress' || record.status === 'done') {
    return { message: `${label(record)} is already ${record.status}`, path }
  }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled. Copy it into a new order.`)
  const quantity = toQuantity(record.quantity, 'Quantity to produce')
  if (quantity <= 0n) fail('Enter a positive quantity to produce before confirming.')
  if (!sameDate.test(record.scheduledDate ?? '')) fail('A scheduled date (YYYY-MM-DD) is required.')
  const bom = await readBom(files, record.bom)
  const demand = computeDemand(bom, quantity, record.bom)
  Object.assign(record, {
    quantity: formatQuantity(quantity), product: bom.product || '', productName: bom.productName || '',
    demand, status: 'confirmed', confirmedAt: now, updatedAt: now,
  })
  await saveRecord(files, order, manufacturing.mime('order'))
  return { message: `Confirmed ${label(record)} · ${demand.length} component${demand.length === 1 ? '' : 's'}`, path }
}

export async function startOrder(files, path, { now }) {
  const order = await readRecord(files, checkPath(path, manufacturing.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'in-progress' || record.status === 'done') return { message: `${label(record)} is already ${record.status}`, path }
  if (record.status !== 'confirmed') fail(`${label(record)} is ${record.status || 'draft'}. Confirm it before starting.`)
  Object.assign(record, { status: 'in-progress', startedAt: now, updatedAt: now })
  await saveRecord(files, order, manufacturing.mime('order'))
  return { message: `Started ${label(record)}`, path }
}

/** The Inventory default warehouse emitted moves go through; missing settings leave the warehouses empty. */
async function defaultWarehouse(files) {
  try {
    const settings = await files.readJson(inventory.settingsPath)
    return typeof settings?.defaultWarehouse === 'string' ? settings.defaultWarehouse : ''
  } catch (error) {
    if (statusOf(error) === 404) return ''
    throw error
  }
}

/**
 * Creates an emitted stock move create-only under its deterministic name. If an earlier, interrupted attempt
 * already wrote it (same `source` pointing at the same order), the existing move is kept: retrying never
 * writes twice.
 */
async function createMove(files, path, move) {
  try {
    await files.write(path, JSON.stringify(move, null, 2), { contentType: inventory.moveMime, ifNoneMatch: '*' })
    return
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(path)
  if (existing?.kind !== 'move' || existing.source?.path !== move.source.path) {
    fail(`${path} already exists and belongs to something else. Rename it and try again.`)
  }
  const shape = value => JSON.stringify([value.product, value.quantity, value.fromWarehouse, value.toWarehouse])
  if (shape(existing) !== shape(move)) {
    fail(`${path} was written by an earlier attempt with different details. Check it against ${move.source.path} before trying again.`)
  }
}

/** The consumption moves for the demand plus the production move for the output, in Inventory's move format. */
export function emittedMoves(record, path, { now, uuid, warehouse }) {
  const date = record.scheduledDate && sameDate.test(record.scheduledDate) ? record.scheduledDate : now.slice(0, 10)
  const move = (name, fields) => ({
    path: `${inventory.moves}/${name}`,
    move: {
      $schema: inventory.moveSchema, schemaVersion: 1, kind: 'move', id: uuid(), state: 'active',
      createdAt: now, updatedAt: now, code: name,
      fromWarehouse: '', fromLocation: '', toWarehouse: '', toLocation: '', date,
      status: 'done', postedAt: now, source: { path }, ...fields,
    },
  })
  const name = record.code || nameOf(path)
  return [
    ...(record.demand ?? []).map((line, index) => move(`${name}-C${index + 1}`, {
      product: line.product, quantity: line.quantity, fromWarehouse: warehouse,
      reference: `Consumed by manufacturing order ${name}`,
    })),
    move(`${name}-OUT`, {
      product: record.product || '', quantity: record.quantity, toWarehouse: warehouse,
      reference: `Produced by manufacturing order ${name}`,
    }),
  ]
}

export async function completeOrder(files, path, { now, uuid }) {
  const order = await readRecord(files, checkPath(path, manufacturing.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'done') return { message: `${label(record)} is already done`, path }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled.`)
  if (record.status !== 'in-progress') fail(`${label(record)} is ${record.status || 'draft'}. Start it before completing.`)
  // Inventory is an optional dependency: moves are only emitted when its /stock-moves container exists.
  let moves = []
  if (await files.stat(inventory.moves)) {
    const warehouse = await defaultWarehouse(files)
    const emitted = emittedMoves(record, path, { now, uuid, warehouse })
    for (const { path: movePath, move } of emitted) await createMove(files, movePath, move)
    moves = emitted.map(({ path: movePath }) => ({ path: movePath }))
  }
  Object.assign(record, {
    status: 'done', completedAt: now, updatedAt: now,
    ...(moves.length ? { moves } : {}),
  })
  await saveRecord(files, order, manufacturing.mime('order'))
  return {
    message: `Completed ${label(record)}${moves.length ? ` and emitted ${moves.length} stock move${moves.length === 1 ? '' : 's'}` : ''}`,
    path,
  }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now, uuid }
  if (operation === 'confirm-mo') return confirmOrder(files, path, options)
  if (operation === 'start-mo') return startOrder(files, path, options)
  if (operation === 'complete-mo') return completeOrder(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
