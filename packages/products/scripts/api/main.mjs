// Products' API script (see api.yaml): the operations other apps and agents call through the platform. It runs with
// Products' own file access; callers never write /products themselves.
import { createNumbered, fail, listRecords, serve, setting, stamp } from './runtime.mjs'
import config from './config.mjs'

const amount = /^((0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?)?$/
const limits = { name: 1000, sku: 64, unit: 32, category: 100, description: 2000 }

/** The product fields in `input` (only the shared ones), checked like the product schema checks them. */
export function productValues(input, { partial = false } = {}) {
  const values = {}
  for (const field of config.fields) {
    if (!Object.hasOwn(input ?? {}, field)) continue
    const value = typeof input[field] === 'string' ? input[field].trim() : input[field]
    if (typeof value !== 'string') fail(`${field} must be text.`)
    if (limits[field] && value.length > limits[field]) fail(`${field} is longer than ${limits[field]} characters.`)
    if ((field === 'listPrice' || field === 'reorderPoint') && !amount.test(value)) fail(`${field} must be a non-negative amount like 12.50.`)
    if (field === 'type' && !['goods', 'service'].includes(value)) fail('type must be goods or service.')
    values[field] = value
  }
  if (!partial && !values.name) fail('Give the product a name.')
  if (partial && Object.hasOwn(values, 'name') && !values.name) fail('A product keeps a name.')
  return values
}

const summary = ({ path, record }) => ({
  path, code: record.code ?? '', name: record.name ?? '', type: record.type ?? 'goods', sku: record.sku ?? '', unit: record.unit ?? '',
  category: record.category ?? '', listPrice: record.listPrice ?? '', reorderPoint: record.reorderPoint ?? '', state: record.state ?? 'active',
})

const products = async files => (await listRecords(files, config.products)).filter(({ record }) => record?.kind === 'product')

/**
 * Creates a product, numbered like any new product. A product with the same SKU is returned instead of a second one,
 * so a retried call (or two apps adding the same item) never duplicates it.
 */
export async function createProduct(input, { files, settings, now }) {
  const values = productValues(input)
  if (values.sku) {
    const existing = (await products(files)).find(({ record }) => (record.sku ?? '').toLowerCase() === values.sku.toLowerCase())
    if (existing) return { ...summary(existing), created: false }
  }
  const prefix = setting(settings, config.prefix.key, config.prefix.default)
  const digits = Math.min(Math.max(Number.parseInt(String(setting(settings, config.digits.key, config.digits.default)), 10) || config.digits.default, 1), 12)
  const record = code => ({
    ...stamp('product', config.schema, now), code,
    name: '', type: 'goods', sku: '', unit: 'ea', category: '', description: '', listPrice: '', reorderPoint: '', ...values,
  })
  let built
  const { path } = await createNumbered(files, config.products, { prefix, digits, mime: config.mime, build: code => (built = record(code)) })
  return { ...summary({ path, record: built }), created: true }
}

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${config.products}/`) || path.slice(config.products.length + 1).includes('/')) {
    fail(`Name a product in ${config.products} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** Changes the given fields of a product, conditionally (a product edited meanwhile is refused, not overwritten). */
export async function updateProduct(input, { files, now }) {
  const path = checkPath(input.path)
  const values = productValues(input.values, { partial: true })
  if (!Object.keys(values).length) fail('Name at least one field to change.')
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  const record = await files.readJson(path)
  if (record?.kind !== 'product' || record.$schema !== config.schema) fail(`${path} is not a product in the shared format. Adopt it in Products first.`)
  if (record.state === 'archived') fail(`Product ${record.code || path} is archived.`)
  const changed = Object.keys(values).filter(field => (record[field] ?? '') !== values[field])
  if (!changed.length) return { ...summary({ path, record }), changed: [] }
  Object.assign(record, values, { updatedAt: now })
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: config.mime, ifMatch: metadata.etag })
  } catch (error) {
    if ((error?.statusCode ?? error?.status) === 412) fail(`${path} changed meanwhile. Try again.`)
    throw error
  }
  return { ...summary({ path, record }), changed }
}

/** Finds products by text (name, code, SKU), SKU, category or type. Archived products only when asked. */
export async function findProducts(input, { files }) {
  const query = String(input.query ?? '').trim().toLowerCase()
  const sku = String(input.sku ?? '').trim().toLowerCase()
  const category = String(input.category ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 500)
  const matches = (await products(files))
    .filter(({ record }) => input.includeArchived || record.state !== 'archived')
    .filter(({ record }) => !input.type || (record.type ?? 'goods') === input.type)
    .filter(({ record }) => !sku || (record.sku ?? '').toLowerCase() === sku)
    .filter(({ record }) => !category || (record.category ?? '').toLowerCase() === category)
    .filter(({ record }) => !query || [record.name, record.code, record.sku].some(value => String(value ?? '').toLowerCase().includes(query)))
    .map(summary)
    .sort((a, b) => a.code.localeCompare(b.code))
  return { products: matches.slice(0, limit), total: matches.length }
}

export default serve({ 'create-product': createProduct, 'update-product': updateProduct, 'find-products': findProducts })
