import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { defaultSettings, schemas, templates } from '../src/contracts.mjs'
import { templates as productTemplates } from '../../products/src/contracts.mjs'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { quoteTotals, run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values, source = templates) => ({ ...source[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })

// Products owns the catalogue Sales quotes; quoted products are its files.
const product = (values = {}) => record('product', { code: 'PROD-0001', name: 'Chair', unit: 'each', listPrice: '499.99', ...values }, productTemplates)
const quotation = (values = {}) => record('quotation', {
  code: 'QUO-0001', date: '2026-03-02', currency: 'ZAR',
  customer: { ...templates.quotation.customer, name: 'Globex' },
  lines: [
    { product: '/products/PROD-0001', description: 'Chair', quantity: '3', unitPrice: '499.99', discount: '10' },
    { product: '', description: 'Delivery', quantity: '1', unitPrice: '0.05', discount: '' },
  ],
  ...values,
})

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/sales.json': defaultSettings,
    '/products/PROD-0001': product(),
    '/quotations/QUO-0001': quotation(),
    ...extra,
  })
}

const call = (files, operation, path, extra = {}) => run({ operation, path, ...extra }, files, options)
const confirm = files => call(files, 'confirm-quotation', '/quotations/QUO-0001')

describe('Sales quotation totals', () => {
  it('rounds each line half up to the cent and discounts the rounded net', () => {
    const totals = quoteTotals([
      { product: '', description: 'a', quantity: '0.333', unitPrice: '10.00', discount: '15' },
      { product: '', description: 'b', quantity: '1', unitPrice: '0.03', discount: '' },
    ])
    // 0.333 × 10.00 = 3.33 net, 15% → 0.4995 → 0.50 discount; 0.03 net, no discount.
    expect(totals).toMatchObject({ subtotal: 336n, discount: 50n, total: 286n })
    expect(totals.nets).toEqual([283n, 3n])
    expect(totals.lines[1].discount).toBe('0')
  })

  it.each([
    [[], /at least one line/],
    [[{ description: ' ', quantity: '1', unitPrice: '1', discount: '' }], /needs a description/],
    [[{ description: 'x', quantity: '0', unitPrice: '1', discount: '' }], /has no quantity/],
    [[{ description: 'x', quantity: '1', unitPrice: '-5', discount: '' }], /unit price must be a non-negative decimal/],
    [[{ description: 'x', quantity: '1', unitPrice: '1', discount: '101' }], /discount cannot exceed 100%/],
    [[{ description: 'x', quantity: '1', unitPrice: '1', discount: '100' }], /total is zero/],
  ])('refuses %j', (lines, error) => expect(() => quoteTotals(lines)).toThrow(error))
})

describe('Sales confirm script', () => {
  it('confirms a quotation: computes exact totals, creates its sales order and locks it', async () => {
    const files = workspace()
    expect(await confirm(files)).toMatchObject({ message: 'Confirmed QUO-0001 into QUO-0001', path: '/sales-orders/QUO-0001' })
    const saved = files.json('/quotations/QUO-0001')
    expect(saved).toMatchObject({
      status: 'confirmed', confirmedAt: now,
      totals: { subtotal: '1500.02', discount: '150.00', total: '1350.02' },
      lines: [{ unitPrice: '499.99', discount: '10' }, { discount: '0' }],
      order: { path: '/sales-orders/QUO-0001' },
    })
    expect(saved.invoice).toBeUndefined()
    const order = files.json('/sales-orders/QUO-0001')
    expect(order).toMatchObject({
      kind: 'order', code: 'QUO-0001', currency: 'ZAR', quotation: '/quotations/QUO-0001',
      customer: { name: 'Globex' }, totals: { total: '1350.02' }, deliveryStatus: 'pending', date: '2026-03-10',
    })
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    expect(ajv.validate(schemas.order, order), JSON.stringify(ajv.errors)).toBe(true)
    expect(ajv.validate(schemas.quotation, saved), JSON.stringify(ajv.errors)).toBe(true)
    expect(await confirm(files)).toMatchObject({ message: 'QUO-0001 is already confirmed', path: '/sales-orders/QUO-0001' })
  })

  it('defaults an empty currency from the Sales settings', async () => {
    const files = workspace({ '/quotations/QUO-0001': quotation({ currency: '' }) })
    await confirm(files)
    expect(files.json('/quotations/QUO-0001').currency).toBe('ZAR')
    expect(files.json('/sales-orders/QUO-0001').currency).toBe('ZAR')
  })

  it('returns what Invoicing needs to draft the invoice, and never writes Invoicing\'s files', async () => {
    const files = workspace({ '/invoices': '' })
    const result = await confirm(files)
    expect(result.message).toBe('Confirmed QUO-0001 into QUO-0001')
    expect(result.invoiceRequest).toMatchObject({
      source: { path: '/quotations/QUO-0001', code: 'QUO-0001' }, currency: 'ZAR', customer: { name: 'Globex' },
      lines: [
        { description: '3 × Chair (10% discount)', quantity: '1', unitPrice: '1349.97' },
        { description: '1 × Delivery', quantity: '1', unitPrice: '0.05' },
      ],
    })
    expect(files.writes.some(path => path.startsWith('/invoices/'))).toBe(false)
    // The request matches Invoicing's create-draft-invoice input schema.
    const contract = parse(await readFile(new URL('../../invoicing/api.yaml', import.meta.url), 'utf8'))
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const schema = contract.spec.operations.find(operation => operation.key === 'create-draft-invoice')['input-schema']
    expect(ajv.validate(schema, result.invoiceRequest), JSON.stringify(ajv.errors)).toBe(true)
  })

  it('records the invoice Invoicing drafted, and asks again for a confirmed quotation without one', async () => {
    const files = workspace({})
    await confirm(files)
    const again = await confirm(files)
    expect(again.invoiceRequest.source.code).toBe('QUO-0001')
    await call(files, 'record-invoice', '/quotations/QUO-0001', { invoice: '/invoices/INV-0007' })
    expect(files.json('/quotations/QUO-0001').invoice).toEqual({ path: '/invoices/INV-0007' })
    expect((await confirm(files)).invoiceRequest).toBeUndefined()
    await expect(call(files, 'record-invoice', '/quotations/QUO-0001', { invoice: '/elsewhere/x' })).rejects.toThrow('Invoicing returned no invoice')
  })

  it('completes a confirm interrupted after its order was created', async () => {
    const files = workspace({})
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/quotations/QUO-0001') throw new Error('network'); return write(path, ...args) }
    await expect(confirm(files)).rejects.toThrow('network')
    expect(files.nodes.has('/sales-orders/QUO-0001')).toBe(true)
    files.write = write
    await confirm(files)
    expect(files.json('/quotations/QUO-0001').status).toBe('confirmed')
    // The order created by the first attempt is kept, not rewritten.
    expect(files.writes.filter(path => path === '/sales-orders/QUO-0001')).toHaveLength(1)
  })

  it('refuses a stranger already sitting at the order\'s deterministic name', async () => {
    const files = workspace({ '/sales-orders/QUO-0001': record('order', { code: 'QUO-0001', quotation: '/quotations/QUO-9999' }) })
    await expect(confirm(files)).rejects.toThrow(/already exists and belongs to something else/)
    expect(files.json('/quotations/QUO-0001').status).toBe('draft')
  })

  it.each([
    ['no customer', quotation({ customer: templates.quotation.customer }), /customer's name/],
    ['no date', quotation({ date: '' }), /quotation date/],
    ['no code', quotation({ code: '' }), /has no number/],
    ['an invalid currency', quotation({ currency: 'ZARS' }), /currency/],
    ['no lines', quotation({ lines: [] }), /at least one line/],
    ['a product outside \/products', quotation({ lines: [{ product: '/customers/CUST-0001', description: 'x', quantity: '1', unitPrice: '1', discount: '' }] }), /must quote a product from \/products/],
    ['a missing product', quotation({ lines: [{ product: '/products/PROD-9999', description: 'x', quantity: '1', unitPrice: '1', discount: '' }] }), /does not exist/],
  ])('refuses to confirm a quotation with %s', async (_, value, error) => {
    const files = workspace({ '/quotations/QUO-0001': value })
    await expect(confirm(files)).rejects.toThrow(error)
    expect(files.json('/quotations/QUO-0001').status).toBe('draft')
    expect(files.nodes.has('/sales-orders/QUO-0001')).toBe(false)
  })

  it('refuses archived products, archived quotations and cancelled quotations', async () => {
    const archivedProduct = workspace({ '/products/PROD-0001': product({ state: 'archived', archivedAt: now }) })
    await expect(confirm(archivedProduct)).rejects.toThrow(/PROD-0001 is archived/)
    const archived = workspace({ '/quotations/QUO-0001': quotation({ state: 'archived', archivedAt: now }) })
    await expect(confirm(archived)).rejects.toThrow(/archived. Restore it first/)
    const cancelled = workspace({ '/quotations/QUO-0001': quotation({ status: 'cancelled' }) })
    await expect(confirm(cancelled)).rejects.toThrow(/cancelled. Reopen it first/)
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace()
    await expect(call(files, 'email', '/quotations/QUO-0001')).rejects.toThrow(/Unsupported operation/)
    await expect(call(files, 'confirm-quotation', '/sales-orders/SO-0001')).rejects.toThrow(/directly in \/quotations/)
    await expect(call(files, 'confirm-quotation', '/quotations/QUO-9999')).rejects.toThrow(/does not exist/)
  })
})
