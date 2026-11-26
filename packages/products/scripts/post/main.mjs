// Products' maintenance script. Before Products, Sales and Inventory each kept product files of their own format in
// /products; `adopt-products` rewrites them in the shared format at the same path (same code, so every reference
// to them still holds), conditionally (If-Match): a file changed meanwhile is left for the next run.
import { fail } from './runtime.mjs'
import config from './config.mjs'

const statusOf = error => error?.statusCode ?? error?.status

async function entries(files, folder) {
  const names = []
  for (let page = 1; page < 1000; page++) {
    const response = await files.list(folder, 500, page)
    const items = response?.items ?? response?.data ?? []
    for (const item of items) if (item?.name) names.push(item.name)
    if (items.length < 500) break
  }
  return names
}

/** The shared-format product for a Sales or Inventory product file (fields neither kept start empty). */
export function adopted(record, now) {
  const text = value => (typeof value === 'string' ? value : '')
  return {
    $schema: config.schema, schemaVersion: 1, kind: 'product', id: record.id, state: record.state === 'archived' ? 'archived' : 'active',
    createdAt: record.createdAt ?? now, updatedAt: now, ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    code: text(record.code), name: text(record.name) || text(record.code), type: 'goods',
    sku: text(record.sku), unit: text(record.unit) || 'ea', category: text(record.category), description: text(record.description),
    listPrice: text(record.listPrice), reorderPoint: text(record.reorderPoint),
  }
}

export async function adoptProducts(files, { now }) {
  const adoptedPaths = []
  const skipped = []
  for (const name of await entries(files, config.products)) {
    const path = `${config.products}/${name}`
    const metadata = await files.stat(path)
    if (!metadata) continue
    let record
    try {
      record = await files.readJson(path)
    } catch {
      skipped.push(path)
      continue
    }
    if (record?.kind !== 'product' || record.$schema === config.schema) continue
    if (!config.legacy.includes(metadata.contentType) && !/\/(sales|inventory)\/v1\/product\.schema\.json$/.test(record.$schema ?? '')) {
      skipped.push(path)
      continue
    }
    try {
      await files.write(path, JSON.stringify(adopted(record, now), null, 2), { contentType: config.mime, ifMatch: metadata.etag })
      adoptedPaths.push(path)
    } catch (error) {
      if (statusOf(error) !== 412) throw error
      skipped.push(path)
    }
  }
  const message = adoptedPaths.length
    ? `Adopted ${adoptedPaths.length} product${adoptedPaths.length === 1 ? '' : 's'}${skipped.length ? `; ${skipped.length} left as they were` : ''}`
    : `Every product is already in the shared format${skipped.length ? `; ${skipped.length} file(s) are not products this can adopt` : ''}`
  return { message, adopted: adoptedPaths, skipped }
}

export const operations = ['adopt-products']

export async function run(parameters, files, { now = new Date().toISOString() } = {}) {
  const { operation } = parameters ?? {}
  if (operation === 'adopt-products') return adoptProducts(files, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
