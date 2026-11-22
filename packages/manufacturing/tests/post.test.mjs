import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { schemas as inventorySchemas } from '../../inventory/src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
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

  it('completes without Inventory: stamps completedAt and emits no moves', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': startedOrder() })
    expect(await post(files, 'complete-mo')).toEqual({ message: 'Completed MO-0001', path: '/manufacturing-orders/MO-0001' })
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({ status: 'done', completedAt: now })
    expect(files.json('/manufacturing-orders/MO-0001').moves).toBeUndefined()
    expect([...files.nodes.keys()].some(path => path.startsWith('/stock-moves/'))).toBe(false)
  })

  it('completes with Inventory installed: emits valid consumption and production moves create-only and links them', async () => {
    const files = shop({
      '/stock-moves': '',
      '/settings/inventory.json': { defaultWarehouse: '/warehouses/WH-0001' },
      '/manufacturing-orders/MO-0001': startedOrder(),
    })
    expect(await post(files, 'complete-mo'))
      .toEqual({ message: 'Completed MO-0001 and emitted 3 stock moves', path: '/manufacturing-orders/MO-0001' })
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({
      status: 'done', completedAt: now,
      moves: [{ path: '/stock-moves/MO-0001-C1' }, { path: '/stock-moves/MO-0001-C2' }, { path: '/stock-moves/MO-0001-OUT' }],
    })
    expect(files.nodes.get('/stock-moves/MO-0001-C1').contentType).toBe('application/vnd.verentis.inventory.move+json')
    expect(files.json('/stock-moves/MO-0001-C1')).toMatchObject({
      kind: 'move', status: 'done', postedAt: now, product: '/products/PRD-0002', quantity: '12',
      fromWarehouse: '/warehouses/WH-0001', toWarehouse: '', date: '2026-03-12',
      reference: 'Consumed by manufacturing order MO-0001', source: { path: '/manufacturing-orders/MO-0001' },
    })
    expect(files.json('/stock-moves/MO-0001-OUT')).toMatchObject({
      product: '/products/PRD-0001', quantity: '3', fromWarehouse: '', toWarehouse: '/warehouses/WH-0001',
      reference: 'Produced by manufacturing order MO-0001',
    })
    // Every emitted move validates against Inventory's packaged move schema.
    for (const name of ['MO-0001-C1', 'MO-0001-C2', 'MO-0001-OUT']) {
      const move = files.json(`/stock-moves/${name}`)
      const valid = validMove(move)
      expect(validMove.errors ?? [], name).toEqual([])
      expect(valid).toBe(true)
    }
    // Idempotent: a second run reports instead of emitting again.
    const writes = files.writes.length
    expect(await post(files, 'complete-mo')).toMatchObject({ message: 'MO-0001 is already done' })
    expect(files.writes.length).toBe(writes)
  })

  it('leaves the warehouses empty when the Inventory settings are missing', async () => {
    const files = shop({ '/stock-moves': '', '/manufacturing-orders/MO-0001': startedOrder() })
    await post(files, 'complete-mo')
    expect(files.json('/stock-moves/MO-0001-OUT')).toMatchObject({ fromWarehouse: '', toWarehouse: '' })
  })

  it('completes an interrupted completion without emitting a second set of moves', async () => {
    const files = shop({ '/stock-moves': '', '/manufacturing-orders/MO-0001': startedOrder() })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/manufacturing-orders/MO-0001') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(post(files, 'complete-mo')).rejects.toThrow('connection lost')
    files.write = write
    await post(files, 'complete-mo')
    expect(files.json('/manufacturing-orders/MO-0001')).toMatchObject({ status: 'done' })
    expect(files.writes.filter(path => path === '/stock-moves/MO-0001-OUT')).toHaveLength(1)
  })

  it('refuses an emitted-move name taken by something else', async () => {
    const files = shop({
      '/stock-moves': '',
      '/stock-moves/MO-0001-C1': { kind: 'move', source: { path: '/inventory-adjustments/ADJ-0001' } },
      '/manufacturing-orders/MO-0001': startedOrder(),
    })
    await expect(post(files, 'complete-mo')).rejects.toThrow(/belongs to something else/)
    expect(files.json('/manufacturing-orders/MO-0001').status).toBe('in-progress')
  })

  it('does not overwrite an order edited while it was being confirmed', async () => {
    const files = shop({ '/manufacturing-orders/MO-0001': order() })
    const write = files.write
    files.write = async (...args) => { files.touch('/manufacturing-orders/MO-0001'); return write(...args) }
    await expect(post(files, 'confirm-mo')).rejects.toThrow(/changed while it was being posted/)
  })
})
