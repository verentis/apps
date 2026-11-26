import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { schemas as inventorySchemas } from '../../inventory/src/contracts.mjs'
import { recordProduction } from '../../inventory/scripts/api/main.mjs'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const inventoryContract = parse(readFileSync(new URL('../../inventory/api.yaml', import.meta.url), 'utf8'))
import { run, runWithApps } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values) => ({ ...templates[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validMove = ajv.compile(inventorySchemas.move)

const bom = (values = {}) => record('bom', {
  code: 'BOM-0001', product: '/products/PRD-0001', productName: 'Standing desk', outputQty: '2',
  components: [
    { product: '/products/PRD-0002', name: 'Leg', quantity: '8' },
    { product: '/products/PRD-0003', name: 'Top', quantity: '2' },
  ],
  routing: [{ operation: 'Assemble', workcenter: 'Bench 1', minutes: '30' }],
  ...values,
})
const order = (values = {}) => record('order', {
  code: 'MO-0001', bom: '/bills-of-materials/BOM-0001', quantity: '3', scheduledDate: '2026-03-12', ...values,
})
const confirmedOrder = (values = {}) => order({
  status: 'confirmed', confirmedAt: now, product: '/products/PRD-0001', productName: 'Standing desk',
  demand: [
    { product: '/products/PRD-0002', name: 'Leg', quantity: '12' },
    { product: '/products/PRD-0003', name: 'Top', quantity: '3' },
  ],
  ...values,
})
const startedOrder = (values = {}) => confirmedOrder({ status: 'in-progress', startedAt: now, ...values })

const shop = (extra = {}) => memoryFiles({ '/bills-of-materials/BOM-0001': bom(), ...extra })
const post = (files, operation, path = '/manufacturing-orders/MO-0001') => run({ operation, path }, files, options)

describe('Manufacturing production script', () => {
  it('confirms a valid draft order, snapshots the product and computes the scaled demand', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': order() })
    expect(await post(files, 'confirm-mo')).toEqual({ message: 'Confirmed MO-0001 · 2 components', path: '/manufacturing-orders/MO-0001' })
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({
      status: 'confirmed', confirmedAt: now, product: '/products/PRD-0001', productName: 'Standing desk',
      demand: [
        { product: '/products/PRD-0002', name: 'Leg', quantity: '12' },
        { product: '/products/PRD-0003', name: 'Top', quantity: '3' },
      ],
    })
    expect(await post(files, 'confirm-mo')).toMatchObject({ message: 'MO-0001 is already confirmed' })
  })

  it('scales fractional demand exactly, rounding half up at four decimals', async () => {
    const files = shop({
      '/bills-of-materials/BOM-0001': bom({ outputQty: '3', components: [{ product: '/products/PRD-0002', name: 'Leg', quantity: '1' }] }),
      '/manufacturing-orders/MO-0001': order({ quantity: '1' }),
    })
    await post(files, 'confirm-mo')
    expect(files.json('/manufacturing-orders/MO-0001').demand).toEqual([{ product: '/products/PRD-0002', name: 'Leg', quantity: '0.3333' }])
  })

  it.each([
    ['no quantity', order({ quantity: '' }), /non-negative decimal/],
    ['a zero quantity', order({ quantity: '0' }), /positive quantity/],
    ['no scheduled date', order({ scheduledDate: '' }), /scheduled date \(YYYY-MM-DD\) is required/],
    ['no BoM', order({ bom: '' }), /Choose a bill of materials/],
    ['an unknown BoM', order({ bom: '/bills-of-materials/BOM-9999' }), /BOM-9999 does not exist/],
    ['a path outside \/bills-of-materials', order({ bom: '/elsewhere/BOM-0001' }), /directly in \/bills-of-materials/],
  ])('refuses to confirm an order with %s', async (_, value, error) => {
    const files = shop({ '/manufacturing-orders/MO-0001': value })
    await expect(post(files, 'confirm-mo')).rejects.toThrow(error)
    expect(files.json('/manufacturing-orders/MO-0001').status).toBe('draft')
  })

  it.each([
    ['archived', bom({ state: 'archived', archivedAt: now }), /BOM-0001 is archived/],
    ['without components', bom({ components: [] }), /has no components/],
    ['with a zero output quantity', bom({ outputQty: '0' }), /positive output quantity/],
    ['with a component missing its product', bom({ components: [{ product: '', name: 'Leg', quantity: '8' }] }), /Component 1 .* has no product/],
    ['with a zero component quantity', bom({ components: [{ product: '/products/PRD-0002', name: 'Leg', quantity: '0' }] }), /needs a positive quantity/],
  ])('refuses to confirm against a BoM %s', async (_, value, error) => {
    const files = shop({ '/bills-of-materials/BOM-0001': value, '/manufacturing-orders/MO-0001': order() })
    await expect(post(files, 'confirm-mo')).rejects.toThrow(error)
    expect(files.json('/manufacturing-orders/MO-0001').status).toBe('draft')
  })

  it('enforces the status transitions', async () => {
    const files = shop({
      '/manufacturing-orders/MO-0001': order(),
      '/manufacturing-orders/MO-0002': order({ code: 'MO-0002', status: 'cancelled', cancelledAt: now }),
      '/manufacturing-orders/MO-0003': confirmedOrder({ code: 'MO-0003' }),
    })
    await expect(post(files, 'start-mo')).rejects.toThrow(/MO-0001 is draft\. Confirm it before starting/)
    await expect(post(files, 'complete-mo')).rejects.toThrow(/MO-0001 is draft\. Start it before completing/)
    await expect(post(files, 'confirm-mo', '/manufacturing-orders/MO-0002')).rejects.toThrow(/MO-0002 is cancelled/)
    await expect(post(files, 'complete-mo', '/manufacturing-orders/MO-0003')).rejects.toThrow(/MO-0003 is confirmed\. Start it before completing/)
    await expect(post(files, 'confirm-mo', '/elsewhere/MO-0001')).rejects.toThrow(/directly in \/manufacturing-orders/)
    await expect(post(files, 'delete')).rejects.toThrow(/Unsupported operation/)
  })

  it('refuses archived orders', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': order({ state: 'archived', archivedAt: now }) })
    await expect(post(files, 'confirm-mo')).rejects.toThrow(/archived/)
  })

  it('starts a confirmed order, idempotently', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': confirmedOrder() })
    expect(await post(files, 'start-mo')).toEqual({ message: 'Started MO-0001', path: '/manufacturing-orders/MO-0001' })
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({ status: 'in-progress', startedAt: now })
    expect(await post(files, 'start-mo')).toMatchObject({ message: 'MO-0001 is already in-progress' })
  })

  it('completes and returns what Inventory needs, never writing Inventory\'s files', async () => {
    const files = shop({ '/stock-moves': '', '/manufacturing-orders/MO-0001': startedOrder() })
    const result = await post(files, 'complete-mo')
    expect(result).toMatchObject({ message: 'Completed MO-0001', path: '/manufacturing-orders/MO-0001' })
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({ status: 'done', completedAt: now })
    expect([...files.nodes.keys()].some(path => path.startsWith('/stock-moves/'))).toBe(false)
    const validRequest = new Ajv2020({ strict: false }).compile(inventoryContract.spec.operations[0]['input-schema'])
    expect(validRequest(result.productionRequest), JSON.stringify(validRequest.errors)).toBe(true)
  })

  it('completing has Inventory record the moves in the same run, and without Inventory just completes', async () => {
    const files = shop({ '/stock-moves': '', '/settings/inventory.json': { defaultWarehouse: '/warehouses/WH-0001' }, '/manufacturing-orders/MO-0001': startedOrder() })
    const inventory = { call: async (app, operation, input) => ({ result: await recordProduction(input, { files, caller: { app: 'manufacturing' }, now }) }) }
    await runWithApps({ operation: 'complete-mo', path: '/manufacturing-orders/MO-0001' }, files, inventory, options)
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({ status: 'done', moves: [{ path: '/stock-moves/MO-0001-C1' }, { path: '/stock-moves/MO-0001-C2' }, { path: '/stock-moves/MO-0001-OUT' }] })

    const alone = shop({ '/manufacturing-orders/MO-0001': startedOrder() })
    const missing = { call: async () => { throw Object.assign(new Error('inventory is not installed'), { code: 'target_not_installed' }) } }
    const result = await runWithApps({ operation: 'complete-mo', path: '/manufacturing-orders/MO-0001' }, alone, missing, options)
    expect(result.productionRequest).toBeUndefined()
    expect(alone.json('/manufacturing-orders/MO-0001').status).toBe('done')
  })

  it('through Inventory\'s record-production: valid moves through the default warehouse, linked once', async () => {
    const files = shop({
      '/stock-moves': '',
      '/settings/inventory.json': { defaultWarehouse: '/warehouses/WH-0001' },
      '/manufacturing-orders/MO-0001': startedOrder(),
    })
    const { productionRequest } = await post(files, 'complete-mo')
    const recorded = await recordProduction(productionRequest, { files, caller: { app: 'manufacturing' }, now })
    expect(recorded.moves).toEqual(['/stock-moves/MO-0001-C1', '/stock-moves/MO-0001-C2', '/stock-moves/MO-0001-OUT'])
    await run({ operation: 'record-moves', path: '/manufacturing-orders/MO-0001', moves: recorded.moves }, files, options)
    expect(files.json('/manufacturing-orders/MO-0001').moves).toEqual(recorded.moves.map(path => ({ path })))
    expect(files.json('/stock-moves/MO-0001-C1')).toMatchObject({
      kind: 'move', status: 'done', product: '/products/PRD-0002', quantity: '12',
      fromWarehouse: '/warehouses/WH-0001', toWarehouse: '', date: '2026-03-12', source: { path: '/manufacturing-orders/MO-0001' },
    })
    expect(files.json('/stock-moves/MO-0001-OUT')).toMatchObject({ product: '/products/PRD-0001', quantity: '3', toWarehouse: '/warehouses/WH-0001' })
    for (const path of recorded.moves) {
      const valid = validMove(files.json(path))
      expect(validMove.errors ?? [], path).toEqual([])
      expect(valid).toBe(true)
    }
    // Asking again records nothing new; a done order with moves asks for nothing.
    const writes = files.writes.filter(path => path.startsWith('/stock-moves/')).length
    await recordProduction(productionRequest, { files, caller: { app: 'manufacturing' }, now })
    expect(files.writes.filter(path => path.startsWith('/stock-moves/')).length).toBe(writes)
    expect((await post(files, 'complete-mo')).productionRequest).toBeUndefined()
  })

  it('Inventory refuses a move name taken by something else', async () => {
    const files = shop({
      '/stock-moves/MO-0001-C1': { kind: 'move', source: { path: '/inventory-adjustments/ADJ-0001' } },
      '/manufacturing-orders/MO-0001': startedOrder(),
    })
    const { productionRequest } = await post(files, 'complete-mo')
    await expect(recordProduction(productionRequest, { files, caller: { app: 'manufacturing' }, now })).rejects.toThrow(/belongs to something else/)
  })

  it('does not overwrite an order edited while it was being confirmed', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': order() })
    const write = files.write
    files.write = async (...args) => { files.touch('/manufacturing-orders/MO-0001'); return write(...args) }
    await expect(post(files, 'confirm-mo')).rejects.toThrow(/changed while it was being posted/)
  })
})
