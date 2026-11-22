import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  containerOf, containers, defaultSettings, fillTemplate, recordKinds, schemas, seedDashboardPath, sourceContainers,
  starterRecords, templates, tileKinds,
} from '../src/contracts.mjs'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, ajv.compile(schema)]))

const expectValid = (kind, value) => {
  const valid = validators[kind](value)
  expect(validators[kind].errors ?? [], kind).toEqual([])
  expect(valid).toBe(true)
}

const packaged = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')
const record = (kind, values = {}) => ({
  ...JSON.parse(fillTemplate(packaged(kind), {
    id: '0f0e0d0c-0b0a-4908-8706-050403020100', now: '2026-01-01T00:00:00Z', name: 'Sample "name"',
  })),
  code: 'X-0001', ...values,
})

describe('Spreadsheet BI contracts', () => {
  it.each(recordKinds)('packaged %s template validates after placeholder substitution', kind => {
    expectValid(kind, record(kind))
    expect(templates[kind].code).toBe('')
  })

  it('validates the seeded settings and points them at the sample dashboard', () => {
    expectValid('settings', defaultSettings)
    expect(defaultSettings.defaultDashboard).toBe(seedDashboardPath)
    expect(seedDashboardPath.startsWith(`${containers.dashboards.path}/`)).toBe(true)
  })

  it('seeds a sample dashboard with real sibling-app fields', () => {
    const [dashboard] = starterRecords
    expectValid('dashboard', dashboard)
    const [customers, invoices] = dashboard.tiles
    expect(customers).toMatchObject({ source: '/customers', kind: 'group-count', groupByField: 'type' })
    expect(invoices).toMatchObject({
      source: '/invoices', kind: 'sum', valueField: 'totals.gross', filter: { field: 'status', equals: 'issued' },
    })
    for (const tile of dashboard.tiles) {
      expect(tileKinds).toContain(tile.kind)
      expect(sourceContainers).toContain(tile.source)
    }
  })

  it('accepts a taken snapshot with values and groups, and requires takenAt once taken', () => {
    const base = {
      ...record('snapshot'), dashboard: seedDashboardPath, status: 'taken', takenAt: '2026-02-01T00:00:00Z',
      results: [
        { sequence: '1', title: 'Customers by type', groups: [{ key: 'customer', value: '2' }] },
        { sequence: '2', title: 'Issued invoice revenue', value: '150.00', note: '1 non-numeric value(s) skipped' },
      ],
    }
    expectValid('snapshot', base)
    const { takenAt: _takenAt, ...untimed } = base
    expect(validators.snapshot(untimed)).toBe(false)
  })

  it('rejects unknown tile kinds and relative sources in dashboards', () => {
    const dashboard = tile => ({ ...record('dashboard'), tiles: [tile] })
    const tile = { sequence: '1', title: 'T', source: '/invoices', kind: 'sum', valueField: 'totals.gross', groupByField: '' }
    expectValid('dashboard', dashboard(tile))
    expect(validators.dashboard(dashboard({ ...tile, kind: 'median' }))).toBe(false)
    expect(validators.dashboard(dashboard({ ...tile, source: 'invoices' }))).toBe(false)
    expect(validators.dashboard(dashboard({ ...tile, valueField: 'totals..gross' }))).toBe(false)
  })

  it('names a container for every record kind', () => {
    for (const kind of recordKinds) expect(containers[containerOf[kind]].holds).toContain(kind)
  })
})
