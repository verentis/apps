import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { schemas } from '../src/contracts.mjs'
import post, { computeTile, formatUnits, run, toUnits } from '../scripts/post/main.mjs'

const now = '2026-03-01T10:00:00Z'
const schemaId = kind => `https://schemas.verentis.io/spreadsheet-bi/v1/${kind}.schema.json`
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validSnapshot = ajv.compile(schemas.snapshot)

const dashboard = (tiles, extra = {}) => ({
  $schema: schemaId('dashboard'), schemaVersion: 1, id: '6b2e4f1a-3c5d-4e7f-9a0b-1c2d3e4f5a01', kind: 'dashboard',
  code: 'BID-0001', state: 'active', createdAt: now, updatedAt: now, name: 'Sales overview', description: '', tiles, ...extra,
})
const snapshot = (extra = {}) => ({
  $schema: schemaId('snapshot'), schemaVersion: 1, id: '6b2e4f1a-3c5d-4e7f-9a0b-1c2d3e4f5a02', kind: 'snapshot',
  code: 'BIS-0001', state: 'active', createdAt: now, updatedAt: now,
  dashboard: '/bi-dashboards/BID-0001', results: [], status: 'draft', ...extra,
})
const customer = (code, type, state = 'active') => ({ kind: 'company', code, state, name: code, ...(type === undefined ? {} : { type }) })
const invoice = (code, status, gross) => ({ kind: 'invoice', code, state: 'active', status, totals: { gross } })

// memoryFiles only knows the paths it is seeded with, so each present container needs a marker entry; omitting
// the marker simulates a sibling app that is not installed.
const workspace = (tiles, { sources = {}, snapshotExtra = {} } = {}) => memoryFiles({
  '/customers': '', '/invoices': '',
  '/bi-dashboards/BID-0001': dashboard(tiles),
  '/bi-snapshots/BIS-0001': snapshot(snapshotExtra),
  ...sources,
})
const take = (files, path = '/bi-snapshots/BIS-0001') => run({ operation: 'take-snapshot', path }, files, { now })

const salesSources = {
  '/customers/CUST-1': customer('CUST-1', 'customer'), '/customers/CUST-2': customer('CUST-2', 'customer'),
  '/customers/CUST-3': customer('CUST-3', 'prospect'), '/customers/CUST-4': customer('CUST-4', 'customer', 'archived'),
  '/customers/CUST-5': customer('CUST-5', undefined),
  '/invoices/INV-1': invoice('INV-1', 'issued', '100.50'), '/invoices/INV-2': invoice('INV-2', 'issued', '49.50'),
  '/invoices/INV-3': invoice('INV-3', 'draft', '10.00'), '/invoices/INV-4': invoice('INV-4', 'issued', 'oops'),
}

describe('take-snapshot', () => {
  it('computes count, filtered sums and groups, stamps takenAt, marks taken and validates', async () => {
    const files = workspace([
      { sequence: '1', title: 'Customers by type', source: '/customers', kind: 'group-count', valueField: '', groupByField: 'type' },
      { sequence: '2', title: 'Issued revenue', source: '/invoices', kind: 'sum', valueField: 'totals.gross', groupByField: '', filter: { field: 'status', equals: 'issued' } },
      { sequence: '3', title: 'All invoices', source: '/invoices', kind: 'count', valueField: '', groupByField: '' },
      { sequence: '4', title: 'Revenue by status', source: '/invoices', kind: 'group-sum', valueField: 'totals.gross', groupByField: 'status' },
    ], { sources: salesSources })
    const { message } = await take(files)
    expect(message).toBe('Took BIS-0001: 4 tile(s) of BID-0001')
    const record = files.json('/bi-snapshots/BIS-0001')
    expect(record).toMatchObject({ status: 'taken', takenAt: now, updatedAt: now })
    expect(validSnapshot(record), JSON.stringify(validSnapshot.errors)).toBe(true)
    expect(record.results).toEqual([
      { sequence: '1', title: 'Customers by type', groups: [
        { key: '(none)', value: '1' }, { key: 'customer', value: '2' }, { key: 'prospect', value: '1' }] },
      { sequence: '2', title: 'Issued revenue', value: '150.00', note: '1 non-numeric value(s) skipped' },
      { sequence: '3', title: 'All invoices', value: '4' },
      { sequence: '4', title: 'Revenue by status', groups: [
        { key: 'draft', value: '10.00' }, { key: 'issued', value: '150.00' }], note: '1 non-numeric value(s) skipped' },
    ])
  })

  it('is idempotent: a second run reports already taken and writes nothing', async () => {
    const files = workspace([{ sequence: '1', title: 'All', source: '/invoices', kind: 'count', valueField: '', groupByField: '' }],
      { sources: salesSources })
    await take(files)
    expect(files.writes).toEqual(['/bi-snapshots/BIS-0001'])
    const before = files.json('/bi-snapshots/BIS-0001')
    const { message } = await take(files)
    expect(message).toBe(`BIS-0001 was already taken at ${now}`)
    expect(files.writes).toEqual(['/bi-snapshots/BIS-0001'])
    expect(files.json('/bi-snapshots/BIS-0001')).toEqual(before)
  })

  it('skips a missing container with a note instead of failing', async () => {
    const files = workspace([
      { sequence: '1', title: 'Tickets', source: '/tickets', kind: 'count', valueField: '', groupByField: '' },
      { sequence: '2', title: 'All invoices', source: '/invoices', kind: 'count', valueField: '', groupByField: '' },
    ], { sources: salesSources })
    await take(files)
    expect(files.json('/bi-snapshots/BIS-0001').results).toEqual([
      { sequence: '1', title: 'Tickets', note: 'Container /tickets does not exist; tile skipped.' },
      { sequence: '2', title: 'All invoices', value: '4' },
    ])
  })

  it('treats a bad field path as non-numeric values and missing group keys, never as a crash', async () => {
    const files = workspace([
      { sequence: '1', title: 'Bad sum', source: '/invoices', kind: 'sum', valueField: 'totals.net.deep', groupByField: '' },
      { sequence: '2', title: 'Bad groups', source: '/customers', kind: 'group-count', valueField: '', groupByField: 'missing.field' },
    ], { sources: salesSources })
    await take(files)
    expect(files.json('/bi-snapshots/BIS-0001').results).toEqual([
      { sequence: '1', title: 'Bad sum', value: '0.00', note: '4 non-numeric value(s) skipped' },
      { sequence: '2', title: 'Bad groups', groups: [{ key: '(none)', value: '4' }] },
    ])
  })

  it.each([
    [[{ sequence: '1', title: 'T', source: '/invoices', kind: 'median', valueField: '', groupByField: '' }], /unknown kind "median"/],
    [[{ sequence: '1', title: 'T', source: 'invoices', kind: 'count', valueField: '', groupByField: '' }], /absolute container path/],
    [[{ sequence: '1', title: 'T', source: '/a/../b', kind: 'count', valueField: '', groupByField: '' }], /absolute container path/],
    [[{ sequence: '1', title: 'T', source: '/invoices', kind: 'sum', valueField: '', groupByField: '' }], /needs a value field/],
    [[{ sequence: '1', title: 'T', source: '/invoices', kind: 'group-sum', valueField: 'totals.gross', groupByField: '' }], /needs a group-by field/],
  ])('rejects invalid tiles without writing (%#)', async (tiles, error) => {
    const files = workspace(tiles, { sources: salesSources })
    await expect(take(files)).rejects.toThrow(error)
    expect(files.writes).toEqual([])
  })

  it.each([
    ['/invoices/INV-1', /Expected a snapshot directly in \/bi-snapshots/],
    ['/bi-snapshots/nested/BIS-1', /Expected a snapshot directly in \/bi-snapshots/],
    ['/bi-snapshots/GHOST', /does not exist/],
  ])('rejects %s as a snapshot path', async (path, error) => {
    const files = workspace([], { sources: salesSources })
    await expect(take(files, path)).rejects.toThrow(error)
  })

  it('rejects snapshots whose dashboard reference leaves /bi-dashboards or is archived', async () => {
    await expect(take(workspace([], { snapshotExtra: { dashboard: '/invoices/INV-1' } })))
      .rejects.toThrow(/Expected a dashboard directly in \/bi-dashboards/)
    await expect(take(workspace([], { snapshotExtra: { dashboard: '' } })))
      .rejects.toThrow(/Expected a dashboard directly in \/bi-dashboards/)
    const files = memoryFiles({
      '/bi-dashboards/BID-0001': dashboard([], { state: 'archived' }),
      '/bi-snapshots/BIS-0001': snapshot(),
    })
    await expect(take(files)).rejects.toThrow(/archived/)
  })

  it('fails with a conflict when the snapshot changes while being taken', async () => {
    const files = workspace([{ sequence: '1', title: 'All', source: '/invoices', kind: 'count', valueField: '', groupByField: '' }],
      { sources: salesSources })
    const readJson = files.readJson
    files.readJson = async path => {
      if (path === '/bi-dashboards/BID-0001') files.touch('/bi-snapshots/BIS-0001')
      return readJson(path)
    }
    await expect(take(files)).rejects.toThrow(/changed while the snapshot was being taken/)
    expect(files.json('/bi-snapshots/BIS-0001').status).toBe('draft')
  })

  it('skips unreadable and archived source records instead of failing', async () => {
    const files = workspace([{ sequence: '1', title: 'All', source: '/invoices', kind: 'count', valueField: '', groupByField: '' }], {
      sources: { '/invoices/INV-1': invoice('INV-1', 'issued', '1.00'), '/invoices/broken': '{not json', '/invoices/INV-9': invoice('INV-9', 'issued', '1.00') },
    })
    files.nodes.get('/invoices/INV-9').content = JSON.stringify(invoice('INV-9', 'issued', '1.00')).replace('"active"', '"archived"')
    await take(files)
    expect(files.json('/bi-snapshots/BIS-0001').results).toEqual([{ sequence: '1', title: 'All', value: '1' }])
  })

  it('rejects unsupported operations', async () => {
    await expect(run({ operation: 'recompute', path: '/bi-snapshots/BIS-0001' }, workspace([])))
      .rejects.toThrow(/Unsupported operation "recompute"/)
  })

  it('reports results through the engine entry point', async () => {
    const files = workspace([], { sources: salesSources })
    const results = []
    await post({ context: { input: { parameters: { operation: 'take-snapshot', path: '/bi-snapshots/BIS-0001' } } }, files, output: { result: async value => results.push(value) } })
    expect(results[0].message).toMatch(/^Took BIS-0001/)
  })
})

describe('decimal math', () => {
  it('sums as BigInt ten-thousandths and formats with at least two decimals', () => {
    expect(toUnits('100.50')).toBe(1005000n)
    expect(toUnits('-0.0001')).toBe(-1n)
    expect(toUnits(7)).toBe(70000n)
    for (const bad of ['oops', '', '1.00000', '01.0', '1e3', null, undefined, Number.NaN, {}]) expect(toUnits(bad), String(bad)).toBeNull()
    expect(formatUnits(1005000n)).toBe('100.50')
    expect(formatUnits(-1n)).toBe('-0.0001')
    expect(formatUnits(0n)).toBe('0.00')
    expect(formatUnits(1234n)).toBe('0.1234')
  })

  it('computeTile falls back to the ordinal when a tile has no usable sequence', () => {
    const result = computeTile({ title: 'T', source: '/invoices', kind: 'count' }, [], 3)
    expect(result).toEqual({ sequence: '3', title: 'T', value: '0' })
  })
})
