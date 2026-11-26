import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, templates } from '../src/contracts.mjs'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { lineTotals, run, runWithApps } from '../scripts/post/main.mjs'
import { createDraftOrder } from '../scripts/api/main.mjs'

const invoicingContract = parse(readFileSync(new URL('../../invoicing/api.yaml', import.meta.url), 'utf8'))
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values) => ({ ...templates[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

const vendor = (values = {}) => record('vendor', { code: 'VEND-0001', name: 'Initech Supplies', ...values })
const order = (values = {}) => record('order', {
  code: 'PO-0001', vendor: '/vendors/VEND-0001', orderDate: '2026-03-02', expectedDate: '2026-03-09', currency: 'ZAR',
  lines: [
    { description: 'Widgets', quantity: '3', unitPrice: '333.33' },
    { description: 'Freight', quantity: '1', unitPrice: '0.05' },
  ],
  ...values,
})

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/purchase.json': defaultSettings,
    '/vendors/VEND-0001': vendor(),
    '/purchase-orders/PO-0001': order(),
    ...extra,
  })
}

const call = (files, operation, path) => run({ operation, path }, files, options)
const confirmed = async (extra = {}) => {
  const files = workspace(extra)
  await call(files, 'confirm-order', '/purchase-orders/PO-0001')
  return files
}

describe('Purchase line totals', () => {
  it('rounds each line half up to the cent and sums the rounded lines', () => {
    const totals = lineTotals([
      { description: ' a ', quantity: '0.333', unitPrice: '10.00' },
      { description: 'b', quantity: '1', unitPrice: '0.03' },
    ])
    expect(totals.total).toBe(336n)
    expect(totals.lines[0].description).toBe('a')
  })

  it.each([
    [[], /at least one line/],
    [[{ description: ' ', quantity: '1', unitPrice: '1' }], /needs a description/],
    [[{ description: 'free', quantity: '1', unitPrice: '0' }], /total is zero/],
    [[{ description: 'x', quantity: '1', unitPrice: '1.005' }], /decimal places/],
  ])('refuses %j', (lines, error) => expect(() => lineTotals(lines)).toThrow(error))
})

describe('Purchase order script', () => {
  it('confirms an order: computes the exact total, snapshots the vendor name and locks the status', async () => {
    const files = workspace()
    expect(await call(files, 'confirm-order', '/purchase-orders/PO-0001')).toMatchObject({ message: 'Confirmed PO-0001 · ZAR 1000.04' })
    expect(files.json('/purchase-orders/PO-0001')).toMatchObject({
      status: 'confirmed', confirmedAt: now, vendorName: 'Initech Supplies', total: '1000.04',
      lines: [{ unitPrice: '333.33' }, { unitPrice: '0.05' }],
    })
    // Idempotent: a second run reports instead of re-confirming.
    const writes = files.writes.length
    expect(await call(files, 'confirm-order', '/purchase-orders/PO-0001')).toMatchObject({ message: 'PO-0001 is already confirmed' })
    expect(files.writes.length).toBe(writes)
  })

  it.each([
    ['no vendor', order({ vendor: '' }), /directly in \/vendors/],
    ['a vendor outside /vendors', order({ vendor: '/customers/CUST-0001' }), /directly in \/vendors/],
    ['a missing vendor', order({ vendor: '/vendors/VEND-0099' }), /does not exist/],
    ['no order date', order({ orderDate: '' }), /order date/],
    ['an expected date before the order date', order({ expectedDate: '2026-03-01' }), /expected date/],
    ['no lines', order({ lines: [] }), /at least one line/],
    ['a zero total', order({ lines: [{ description: 'Free', quantity: '1', unitPrice: '0' }] }), /total is zero/],
    ['a cancelled status', order({ status: 'cancelled', cancelledAt: now }), /cancelled/],
    ['an archived state', order({ state: 'archived', archivedAt: now }), /archived/],
  ])('refuses to confirm an order with %s', async (_, value, error) => {
    const files = workspace({ '/purchase-orders/PO-0001': value })
    await expect(call(files, 'confirm-order', '/purchase-orders/PO-0001')).rejects.toThrow(error)
    expect(files.json('/purchase-orders/PO-0001').status).toBe(value.status)
  })

  it('refuses to confirm against an archived or unnamed vendor', async () => {
    const archived = workspace({ '/vendors/VEND-0001': vendor({ state: 'archived', archivedAt: now }) })
    await expect(call(archived, 'confirm-order', '/purchase-orders/PO-0001')).rejects.toThrow(/archived/)
    const unnamed = workspace({ '/vendors/VEND-0001': vendor({ name: '' }) })
    await expect(call(unnamed, 'confirm-order', '/purchase-orders/PO-0001')).rejects.toThrow(/Name the vendor/)
  })

  it('receives a confirmed order without Invoicing: marks receipt and drafts no bill', async () => {
    const files = await confirmed()
    expect(await call(files, 'receive-order', '/purchase-orders/PO-0001')).toMatchObject({ message: 'Received PO-0001', path: '/purchase-orders/PO-0001' })
    expect(files.json('/purchase-orders/PO-0001')).toMatchObject({ status: 'received', receivedAt: now })
    expect(files.json('/purchase-orders/PO-0001').bill).toBeUndefined()
    expect([...files.nodes.keys()].some(path => path.startsWith('/invoices/'))).toBe(false)
  })

  it('receives and asks Invoicing for the vendor bill, never writing Invoicing\'s files', async () => {
    const files = await confirmed({ '/invoices': '' })
    const result = await call(files, 'receive-order', '/purchase-orders/PO-0001')
    expect(result).toMatchObject({ message: 'Received PO-0001', path: '/purchase-orders/PO-0001' })
    expect(files.writes.some(path => path.startsWith('/invoices/'))).toBe(false)
    const validRequest = new Ajv2020({ strict: false }).compile(invoicingContract.spec.operations[0]['input-schema'])
    expect(validRequest(result.invoiceRequest), JSON.stringify(validRequest.errors)).toBe(true)
    expect(result.invoiceRequest).toMatchObject({
      source: { path: '/purchase-orders/PO-0001', code: 'PO-0001' }, customer: { name: 'Initech Supplies' },
      lines: [{ description: 'Widgets', quantity: '3', unitPrice: '333.33' }, { description: 'Freight', quantity: '1', unitPrice: '0.05' }],
    })
  })

  it('records the bill Invoicing drafted, and asks again for a received order without one', async () => {
    const files = await confirmed()
    await call(files, 'receive-order', '/purchase-orders/PO-0001')
    expect((await call(files, 'receive-order', '/purchase-orders/PO-0001')).invoiceRequest.source.code).toBe('PO-0001')
    await run({ operation: 'record-bill', path: '/purchase-orders/PO-0001', bill: '/invoices/INV-0009' }, files, options)
    expect(files.json('/purchase-orders/PO-0001').bill).toEqual({ path: '/invoices/INV-0009' })
    expect(await call(files, 'receive-order', '/purchase-orders/PO-0001')).toMatchObject({ message: 'PO-0001 is already received', path: '/invoices/INV-0009' })
  })

  it('receiving has Invoicing draft the bill in the same run and records it', async () => {
    const files = await confirmed()
    const invoicing = { call: async (app, operation, input) => ({ result: { path: `/invoices/${input.source.code}` } }) }
    await runWithApps({ operation: 'receive-order', path: '/purchase-orders/PO-0001' }, files, invoicing, options)
    expect(files.json('/purchase-orders/PO-0001')).toMatchObject({ status: 'received', bill: { path: '/invoices/PO-0001' } })
  })

  it('refuses to receive an order that is not confirmed', async () => {
    const files = workspace()
    await expect(call(files, 'receive-order', '/purchase-orders/PO-0001')).rejects.toThrow(/is draft. Confirm it before receiving/)
  })

  it('fails a confirm raced by a concurrent edit instead of overwriting it', async () => {
    const files = workspace()
    const readJson = files.readJson
    files.readJson = async path => {
      const value = await readJson(path)
      if (path === '/purchase-orders/PO-0001') files.touch(path)
      return value
    }
    await expect(call(files, 'confirm-order', '/purchase-orders/PO-0001')).rejects.toThrow(/changed while it was being posted/)
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace()
    await expect(call(files, 'email', '/purchase-orders/PO-0001')).rejects.toThrow(/Unsupported operation/)
    await expect(call(files, 'confirm-order', '/vendors/VEND-0001')).rejects.toThrow(/directly in \/purchase-orders/)
  })
})

describe('Purchase API', () => {
  it('drafts an order for a reorder and returns the same draft when asked again', async () => {
    const files = memoryFiles({ '/purchase-orders/PO-0002': { kind: 'order', code: 'PO-0002' } })
    const context = { files, settings: { get: () => undefined }, caller: { app: 'inventory' }, now: '2026-11-25T10:00:00Z' }
    const input = { source: { path: '/products#reorder-2026-11-25', code: 'Reorder 2026-11-25' }, lines: [{ description: 'Ryegrass 25 kg', quantity: '8' }] }
    expect(await createDraftOrder(input, context)).toEqual({ path: '/purchase-orders/PO-0003', code: 'PO-0003', created: true })
    expect(files.json('/purchase-orders/PO-0003')).toMatchObject({ kind: 'order', status: 'draft', orderDate: '2026-11-25',
      lines: [{ description: 'Ryegrass 25 kg', quantity: '8', unitPrice: '' }], source: { app: 'inventory', path: '/products#reorder-2026-11-25' } })
    expect((await createDraftOrder(input, context)).created).toBe(false)
  })
})
