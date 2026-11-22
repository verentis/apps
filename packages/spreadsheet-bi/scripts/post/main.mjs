// Takes Spreadsheet BI snapshots. The snapshot form runs this script (run-script) against a saved snapshot: it
// reads the referenced dashboard's tiles, computes every result over the source containers with exact BigInt
// decimal-string math (never floats), writes the results into the snapshot, stamps takenAt and marks it taken —
// the form locks taken snapshots. The snapshot is updated conditionally (If-Match), so a concurrent edit fails
// instead of being overwritten; a snapshot that is already taken returns a friendly message, so retries are safe.
// Missing source containers and non-numeric values never fail a run: the affected tile keeps a note instead.
export const operations = ['take-snapshot']
export const bi = {
  dashboards: '/bi-dashboards',
  snapshots: '/bi-snapshots',
  dashboardMime: 'application/vnd.verentis.spreadsheet-bi.dashboard+json',
  snapshotMime: 'application/vnd.verentis.spreadsheet-bi.snapshot+json',
}
export const tileKinds = ['count', 'sum', 'group-count', 'group-sum']
/** Amounts are decimal strings with at most four decimals; they are summed as BigInt ten-thousandths. */
export const scale = 4
const factor = 10n ** BigInt(scale)

class SnapshotError extends Error {}
export const fail = message => { throw new SnapshotError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This snapshot'

function checkPath(path, container, what) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected ${what} directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A record with the ETag it was read at, so the update can be conditional. */
async function readRecord(files, path, kind) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== kind) fail(`${path} is not a ${kind}.`)
  if (record.state === 'archived') fail(`${record.code || path} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed snapshot back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveSnapshot(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: bi.snapshotMime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while the snapshot was being taken. Reload it and try again.`)
    throw error
  }
}

/** A dot-notation field value (`totals.gross`); undefined when any step is missing. */
export const fieldValue = (record, path) => String(path || '').split('.')
  .reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), record)

const decimal = /^(-?)(0|[1-9][0-9]{0,15})(\.([0-9]{1,4}))?$/

/** `"12.50"` (or a finite JSON number) → BigInt ten-thousandths; null when not an exact decimal. */
export function toUnits(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  const match = typeof text === 'string' && text.trim().match(decimal)
  if (!match) return null
  const units = BigInt(match[2] + (match[4] ?? '').padEnd(scale, '0'))
  return match[1] === '-' ? -units : units
}

/** BigInt ten-thousandths → a decimal string, trailing zeros trimmed to at least two decimals (`"12.50"`). */
export function formatUnits(units) {
  const negative = units < 0n
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const fraction = digits.slice(-scale).replace(/0+$/, '').padEnd(2, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${fraction}`
}

/** Every direct child of a folder (`{ name, path }`), across pages. */
async function listFolder(files, path) {
  const children = []
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const response = await files.list(path, 500, pageNo)
    const page = response?.children ?? response
    const items = Array.isArray(page) ? page : page?.data ?? []
    for (const item of items) {
      const name = item.name ?? (item.path ?? '').slice((item.path ?? '').lastIndexOf('/') + 1)
      children.push({ name, path: item.path ?? `${path.replace(/\/+$/, '')}/${name}` })
    }
    const pageCount = Array.isArray(page) ? 1 : page?.pageCount ?? 1
    if (pageNo >= pageCount || items.length === 0) break
  }
  return children
}

/** The active JSON records of a container; unreadable children are skipped. */
async function readContainer(files, path) {
  const records = []
  for (const child of await listFolder(files, path)) {
    let record
    try {
      record = await files.readJson(child.path)
    } catch (error) {
      if (statusOf(error) === 404 || statusOf(error) === 403 || error instanceof SyntaxError) continue
      throw error
    }
    if (record && typeof record === 'object' && !Array.isArray(record) && record.state !== 'archived') records.push(record)
  }
  return records
}

const keeps = (record, filter) => !filter || !filter.field
  || String(fieldValue(record, filter.field)) === String(filter.equals ?? '')

const groupKeyOf = (record, field) => {
  const value = fieldValue(record, field)
  return value === undefined || value === null || value === '' ? '(none)' : String(value)
}

/** Validates one tile and computes its result over `records` (null when the container is missing). */
export function computeTile(tile, records, ordinal) {
  const at = `Tile ${ordinal}${tile.title ? ` (${tile.title})` : ''}`
  if (!tileKinds.includes(tile.kind)) fail(`${at} has unknown kind ${JSON.stringify(tile.kind ?? '')}. Expected one of ${tileKinds.join(', ')}.`)
  if (typeof tile.source !== 'string' || !tile.source.startsWith('/') || tile.source === '/' || tile.source.includes('..')) {
    fail(`${at} needs an absolute container path as its source (got ${JSON.stringify(tile.source ?? '')}).`)
  }
  const sums = tile.kind === 'sum' || tile.kind === 'group-sum'
  const groups = tile.kind === 'group-count' || tile.kind === 'group-sum'
  if (sums && !tile.valueField) fail(`${at} is a ${tile.kind} and needs a value field (dot notation, e.g. totals.gross).`)
  if (groups && !tile.groupByField) fail(`${at} is a ${tile.kind} and needs a group-by field.`)
  const sequence = /^[0-9]{1,4}$/.test(String(tile.sequence ?? '')) ? String(tile.sequence) : String(ordinal)
  const base = { sequence, title: tile.title || '' }
  if (records === null) return { ...base, note: `Container ${tile.source} does not exist; tile skipped.` }
  const matching = records.filter(record => keeps(record, tile.filter))
  const note = skipped => (skipped > 0 ? { note: `${skipped} non-numeric value(s) skipped` } : {})
  const sumOf = subset => {
    const units = subset.map(record => toUnits(fieldValue(record, tile.valueField)))
    const valid = units.filter(value => value !== null)
    return { value: formatUnits(valid.reduce((total, value) => total + value, 0n)), skipped: units.length - valid.length }
  }
  if (tile.kind === 'count') return { ...base, value: String(matching.length) }
  if (tile.kind === 'sum') {
    const { value, skipped } = sumOf(matching)
    return { ...base, value, ...note(skipped) }
  }
  const keys = [...new Set(matching.map(record => groupKeyOf(record, tile.groupByField)))].sort()
  if (tile.kind === 'group-count') {
    return { ...base, groups: keys.map(key => ({ key, value: String(matching.filter(record => groupKeyOf(record, tile.groupByField) === key).length) })) }
  }
  let skippedTotal = 0
  const grouped = keys.map(key => {
    const { value, skipped } = sumOf(matching.filter(record => groupKeyOf(record, tile.groupByField) === key))
    skippedTotal += skipped
    return { key, value }
  })
  return { ...base, groups: grouped, ...note(skippedTotal) }
}

/** Reads the snapshot's dashboard, computes every tile and locks the results into the snapshot. */
export async function takeSnapshot(files, path, { now }) {
  const snapshot = await readRecord(files, checkPath(path, bi.snapshots, 'a snapshot'), 'snapshot')
  const { record } = snapshot
  if (record.status === 'taken') return { message: `${label(record)} was already taken at ${record.takenAt}`, path }
  checkPath(record.dashboard, bi.dashboards, 'a dashboard')
  const dashboard = (await readRecord(files, record.dashboard, 'dashboard')).record
  const tiles = Array.isArray(dashboard.tiles) ? dashboard.tiles : []
  const ordered = tiles.slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
  const containers = new Map()
  const results = []
  for (const [index, tile] of ordered.entries()) {
    const source = typeof tile.source === 'string' ? tile.source : ''
    if (!containers.has(source) && source.startsWith('/') && source !== '/') {
      containers.set(source, (await files.stat(source)) ? await readContainer(files, source) : null)
    }
    results.push(computeTile(tile, containers.get(source) ?? null, index + 1))
  }
  Object.assign(record, { results, takenAt: now, status: 'taken', updatedAt: now })
  await saveSnapshot(files, snapshot)
  return { message: `Took ${label(record)}: ${results.length} tile(s) of ${dashboard.code || record.dashboard}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'take-snapshot') return takeSnapshot(files, path, { now })
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
