// Inventory's API script (see api.yaml): the operations other apps call through the platform. It runs with
// Inventory's own file access; callers never write /stock-moves themselves.
import { fail, serve, stamp } from './runtime.mjs'
import config from './config.mjs'

const statusOf = error => error?.statusCode ?? error?.status

/** The default warehouse production goes through; missing settings leave the warehouses empty. */
async function defaultWarehouse(files) {
  try {
    const settings = await files.readJson(config.settingsPath)
    return typeof settings?.defaultWarehouse === 'string' ? settings.defaultWarehouse : ''
  } catch (error) {
    if (statusOf(error) === 404) return ''
    throw error
  }
}

/** Writes one move create-only; a move already there from the same source with the same details is kept. */
async function write(files, path, move) {
  try {
    await files.write(path, JSON.stringify(move, null, 2), { contentType: config.mime, ifNoneMatch: '*' })
    return
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(path)
  if (existing?.kind !== 'move' || existing.source?.path !== move.source.path) fail(`${path} already exists and belongs to something else.`)
  const shape = value => JSON.stringify([value.product, value.quantity, value.fromWarehouse, value.toWarehouse])
  if (shape(existing) !== shape(move)) fail(`${path} was recorded earlier with different quantities. Check it before trying again.`)
}

/**
 * Records a production run as done stock moves through the default warehouse: one out per consumed component and one
 * in for the produced output, named after the source (`MO-0001-C1`, `MO-0001-OUT`). Recording the same production
 * again returns the same moves.
 */
export async function recordProduction(input, { files, caller, now }) {
  if (!caller?.app) fail('The calling app is unknown.')
  const name = String(input.source.code || input.source.path.split('/').pop())
  const warehouse = await defaultWarehouse(files)
  const date = input.date || now.slice(0, 10)
  const base = (code, fields) => ({
    ...stamp('move', config.schema, now), code, fromWarehouse: '', fromLocation: '', toWarehouse: '', toLocation: '',
    date, status: 'done', postedAt: now, source: { path: input.source.path }, ...fields,
  })
  const moves = [
    ...input.consumed.map((line, index) => [`${name}-C${index + 1}`, base(`${name}-C${index + 1}`, {
      product: line.product, quantity: line.quantity, fromWarehouse: warehouse, reference: `Consumed by ${caller.app} ${name}`,
    })]),
    [`${name}-OUT`, base(`${name}-OUT`, {
      product: input.produced.product, quantity: input.produced.quantity, toWarehouse: warehouse, reference: `Produced by ${caller.app} ${name}`,
    })],
  ]
  for (const [code, move] of moves) await write(files, `${config.moves}/${code}`, move)
  return { moves: moves.map(([code]) => `${config.moves}/${code}`) }
}

export default serve({ 'record-production': recordProduction })
