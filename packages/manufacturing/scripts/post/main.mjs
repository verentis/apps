// Confirms, starts and completes Manufacturing orders. Canvas forms run this script (run-script) against a saved
// order; it validates the production rules the files themselves cannot enforce (an active bill of materials,
// positive quantities), computes the exact component demand, then writes with the file access its installer
// consented to (manifest `file-access`).
//
// Completing returns what Inventory needs to record the production; the script asks Inventory through the platform
// (Inventory's `record-production` returns the same moves when asked again) and `record-moves` stores the links.
// Manufacturing never writes Inventory's files. Orders are updated conditionally (If-Match), so a concurrent edit
// fails instead of being overwritten.
import { divideHalfUp, fail, formatMinor, nameOf, nowIso, readRecord, saveRecord, statusOf, toMinor } from './ledger.mjs'
import { withAppCalls } from './app-calls.mjs'

export const operations = ['confirm-mo', 'start-mo', 'complete-mo', 'record-moves']

export const manufacturing = {
  boms: '/bills-of-materials',
  orders: '/manufacturing-orders',
  mime: kind => `application/vnd.verentis.manufacturing.${kind}+json`,
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

/**
 * What Inventory needs to record the completed order (its `record-production` operation): the component demand
 * consumed and the output produced. The script asks Inventory through the platform; Manufacturing never writes
 * Inventory's files.
 */
export function productionRequest(record, path) {
  const date = record.scheduledDate && sameDate.test(record.scheduledDate) ? record.scheduledDate : ''
  return {
    source: { path, code: record.code || nameOf(path) },
    ...(date ? { date } : {}),
    consumed: (record.demand ?? []).map(line => ({ product: line.product, quantity: line.quantity })),
    produced: { product: record.product || '', quantity: record.quantity },
  }
}

/** Records the stock moves Inventory wrote for a completed order (the paths its operation returned). */
export async function recordMoves(files, path, movePaths, { now }) {
  const order = await readRecord(files, checkPath(path, manufacturing.orders), 'order')
  const { record } = order
  if (record.status !== 'done') fail(`${label(record)} is not done.`)
  const paths = Array.isArray(movePaths) ? movePaths : []
  if (!paths.length || paths.some(item => typeof item !== 'string' || !item.startsWith('/stock-moves/'))) fail('Inventory returned no stock moves.')
  Object.assign(record, { moves: paths.map(item => ({ path: item })), updatedAt: now })
  await saveRecord(files, order, manufacturing.mime('order'))
  return { message: `Recorded ${paths.length} stock move${paths.length === 1 ? '' : 's'} for ${label(record)}`, path }
}

export async function completeOrder(files, path, { now }) {
  const order = await readRecord(files, checkPath(path, manufacturing.orders), 'order')
  const { record } = order
  checkActive(record)
  if (record.status === 'done') {
    return { message: `${label(record)} is already done`, path, ...(record.moves?.length ? {} : { productionRequest: productionRequest(record, path) }) }
  }
  if (record.status === 'cancelled') fail(`${label(record)} is cancelled.`)
  if (record.status !== 'in-progress') fail(`${label(record)} is ${record.status || 'draft'}. Start it before completing.`)
  Object.assign(record, { status: 'done', completedAt: now, updatedAt: now })
  await saveRecord(files, order, manufacturing.mime('order'))
  // The script asks Inventory (when installed; see `handOvers`) to record the stock moves from this, then records their links.
  return { message: `Completed ${label(record)}`, path, productionRequest: productionRequest(record, path) }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'confirm-mo') return confirmOrder(files, path, options)
  if (operation === 'start-mo') return startOrder(files, path, options)
  if (operation === 'complete-mo') return completeOrder(files, path, options)
  if (operation === 'record-moves') return recordMoves(files, path, parameters.moves, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

/**
 * Operations that hand a request to another app: the script calls that app's API operation itself
 * (`engine.apps.call`, as the same user under the other app's consent) and records the result, in the same run.
 */
export const handOvers = {
  'complete-mo': { app: 'inventory', operation: 'record-production', field: 'productionRequest', recordOperation: 'record-moves', parameter: 'moves', returned: 'moves', key: 'production' },
}
export const runWithApps = withAppCalls(run, handOvers)

export default async function post(engine) {
  await engine.output.result(await runWithApps(engine.context.input.parameters, engine.files, engine.apps))
}
