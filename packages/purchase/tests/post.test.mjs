import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, templates } from '../src/contracts.mjs'
import { schemas as invoicingSchemas } from '../../invoicing/src/contracts.mjs'
import { invoicing, lineTotals, run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values) => ({ ...templates[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validBill = ajv.compile(invoicingSchemas.invoice)

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

  it('receives with Invoicing installed: drafts a valid vendor bill create-only and links it', async () => {
    const files = await confirmed({ '/invoices': '' })
    expect(await call(files, 'receive-order', '/purchase-orders/PO-0001'))
      .toMatchObject({ message: 'Received PO-0001 and drafted vendor bill PO-0001-BILL', path: '/invoices/PO-0001-BILL' })
    expect(files.json('/purchase-orders/PO-0001')).toMatchObject({ status: 'received', bill: { path: '/invoices/PO-0001-BILL' } })
    const bill = files.json('/invoices/PO-0001-BILL')
    expect(files.nodes.get('/invoices/PO-0001-BILL').contentType).toBe(invoicing.invoiceMime)
    expect(bill).toMatchObject({
      kind: 'invoice', status: 'draft', reference: '/purchase-orders/PO-0001',
      customer: { name: 'Initech Supplies' },
      lines: [{ description: 'Widgets', quantity: '3', unitPrice: '333.33', taxRate: '' }, { description: 'Freight', quantity: '1', unitPrice: '0.05', taxRate: '' }],
    })
    const valid = validBill(bill)
    expect(validBill.errors ?? []).toEqual([])
    expect(valid).toBe(true)
    // Idempotent: a second run reports instead of drafting another bill.
    const writes = files.writes.length
    expect(await call(files, 'receive-order', '/purchase-orders/PO-0001')).toMatchObject({ message: 'PO-0001 is already received', path: '/invoices/PO-0001-BILL' })
    expect(files.writes.length).toBe(writes)
  })

  it('completes a receipt interrupted after the bill was drafted', async () => {
    const files = await confirmed({ '/invoices': '' })
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/purchase-orders/PO-0001') throw new Error('network'); return write(path, ...args) }
    await expect(call(files, 'receive-order', '/purchase-orders/PO-0001')).rejects.toThrow('network')
    files.write = write
    await call(files, 'receive-order', '/purchase-orders/PO-0001')
    expect(files.json('/purchase-orders/PO-0001')).toMatchObject({ status: 'received', bill: { path: '/invoices/PO-0001-BILL' } })
    expect(files.writes.filter(path => path === '/invoices/PO-0001-BILL')).toHaveLength(1)
  })

  it('refuses a bill name that already belongs to something else', async () => {
    const files = await confirmed({ '/invoices': '', '/invoices/PO-0001-BILL': { kind: 'invoice', reference: '/purchase-orders/PO-0099' } })
    await expect(call(files, 'receive-order', '/purchase-orders/PO-0001')).rejects.toThrow(/belongs to something else/)
    expect(files.json('/purchase-orders/PO-0001').status).toBe('confirmed')
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
