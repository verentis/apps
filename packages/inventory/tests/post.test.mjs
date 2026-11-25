import { describe, expect, it } from 'vitest'
import { starterRecords, templates } from '../src/contracts.mjs'
import { starterRecords as starterProducts, templates as productTemplates } from '../../products/src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
// Products owns the catalogue: its sample products are the ones Inventory's sample moves stock.
const record = (kind, values) => ({ ...(kind === 'product' ? productTemplates : templates)[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })
const wh = '/warehouses/WH-0001'
const desk = '/products/PRD-0001'

function stock(extra = {}) {
  return memoryFiles({
    ...Object.fromEntries(starterProducts.map(item => [`/products/${item.code}`, item])),
    ...Object.fromEntries(starterRecords.map(item => [`/${item.kind === 'warehouse' ? 'warehouses' : 'stock-moves'}/${item.code}`, item])),
    ...extra,
  })
}

const move = (values = {}) => record('move', {
  code: 'MOV-0100', product: desk, quantity: '4', fromWarehouse: wh, fromLocation: 'Stock',
  toWarehouse: '', toLocation: '', date: '2026-03-05', reference: 'Delivery', ...values,
})
const adjustment = (values = {}) => record('adjustment', {
  code: 'ADJ-0001', product: desk, warehouse: wh, location: 'Stock', countedQty: '18', date: '2026-03-09', ...values,
})
const post = (files, operation, path) => run({ operation, path }, files, options)

describe('Inventory posting script', () => {
  it('posts a valid draft move, normalises the quantity and is idempotent', async () => {
    const files = stock({ '/stock-moves/MOV-0100': move({ quantity: '4.5000' }) })
    expect(await post(files, 'post-move', '/stock-moves/MOV-0100')).toEqual({ message: 'Posted MOV-0100', path: '/stock-moves/MOV-0100' })
    expect(files.json('/stock-moves/MOV-0100')).toMatchObject({ status: 'done', postedAt: now, quantity: '4.5' })
    expect(await post(files, 'post-move', '/stock-moves/MOV-0100')).toMatchObject({ message: 'MOV-0100 is already done' })
  })

  it.each([
    ['no quantity', move({ quantity: '' }), /non-negative decimal/],
    ['a zero quantity', move({ quantity: '0' }), /positive quantity/],
    ['no product', move({ product: '' }), /Choose the product/],
    ['an unknown product', move({ product: '/products/PRD-9999' }), /PRD-9999 does not exist/],
    ['a path outside \/products', move({ product: '/elsewhere/PRD-0001' }), /Choose a product from \/products/],
    ['no warehouse on either side', move({ fromWarehouse: '', toWarehouse: '' }), /Set the from or to warehouse/],
    ['an unknown warehouse', move({ fromWarehouse: '/warehouses/WH-9999' }), /WH-9999 does not exist/],
    ['a location the warehouse does not have', move({ fromLocation: 'Mezzanine' }), /no from location "Mezzanine"/],
    ['the same from and to location', move({ toWarehouse: wh, toLocation: 'Stock' }), /location to itself/],
    ['no date', move({ date: '' }), /move date \(YYYY-MM-DD\) is required/],
  ])('refuses to post a move with %s', async (_, value, error) => {
    const files = stock({ '/stock-moves/MOV-0100': value })
    await expect(post(files, 'post-move', '/stock-moves/MOV-0100')).rejects.toThrow(error)
    expect(files.json('/stock-moves/MOV-0100').status).toBe('draft')
  })

  it('refuses archived records and products', async () => {
    const files = stock({
      '/stock-moves/MOV-0100': move({ state: 'archived', archivedAt: now }),
      '/products/PRD-0009': record('product', { code: 'PRD-0009', name: 'Old desk', state: 'archived', archivedAt: now }),
      '/stock-moves/MOV-0101': move({ code: 'MOV-0101', product: '/products/PRD-0009' }),
    })
    await expect(post(files, 'post-move', '/stock-moves/MOV-0100')).rejects.toThrow(/archived/)
    await expect(post(files, 'post-move', '/stock-moves/MOV-0101')).rejects.toThrow(/PRD-0009 is archived/)
  })

  it('does not overwrite a move edited while it was being posted', async () => {
    const files = stock({ '/stock-moves/MOV-0100': move() })
    const write = files.write
    files.write = async (...args) => { files.touch('/stock-moves/MOV-0100'); return write(...args) }
    await expect(post(files, 'post-move', '/stock-moves/MOV-0100')).rejects.toThrow(/changed while it was being posted/)
  })

  it('applies a surplus count as a corrective move in, idempotently', async () => {
    // Seeded done moves put 20 desks into WH-0001 Stock; counting 23 needs 3 more in.
    const files = stock({ '/inventory-adjustments/ADJ-0001': adjustment({ countedQty: '23' }) })
    expect(await post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001'))
      .toEqual({ message: 'Applied ADJ-0001 with ADJ-0001', path: '/stock-moves/ADJ-0001' })
    expect(files.json('/stock-moves/ADJ-0001')).toMatchObject({
      kind: 'move', status: 'done', postedAt: now, product: desk, quantity: '3',
      fromWarehouse: '', toWarehouse: wh, toLocation: 'Stock', date: '2026-03-09',
      reference: 'Inventory adjustment ADJ-0001', source: { path: '/inventory-adjustments/ADJ-0001' },
    })
    expect(files.json('/inventory-adjustments/ADJ-0001')).toMatchObject({
      status: 'applied', appliedAt: now, move: { path: '/stock-moves/ADJ-0001' },
    })
    expect(await post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001'))
      .toEqual({ message: 'ADJ-0001 is already applied', path: '/stock-moves/ADJ-0001' })
    expect(files.nodes.size).toBeGreaterThan(0)
  })

  it('applies a shortage count as a corrective move out', async () => {
    const files = stock({ '/inventory-adjustments/ADJ-0001': adjustment({ countedQty: '18' }) })
    await post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001')
    expect(files.json('/stock-moves/ADJ-0001')).toMatchObject({
      quantity: '2', fromWarehouse: wh, fromLocation: 'Stock', toWarehouse: '',
    })
  })

  it('applies a matching count without a corrective move', async () => {
    const files = stock({ '/inventory-adjustments/ADJ-0001': adjustment({ countedQty: '20' }) })
    expect(await post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001'))
      .toEqual({ message: 'Applied ADJ-0001: the count matches the stock on hand', path: '/inventory-adjustments/ADJ-0001' })
    expect(await files.stat('/stock-moves/ADJ-0001')).toBeNull()
    expect(files.json('/inventory-adjustments/ADJ-0001')).toMatchObject({ status: 'applied', appliedAt: now })
    expect(files.json('/inventory-adjustments/ADJ-0001').move).toBeUndefined()
  })

  it('completes an interrupted apply without writing a second corrective move', async () => {
    const files = stock({ '/inventory-adjustments/ADJ-0001': adjustment({ countedQty: '23' }) })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/inventory-adjustments/ADJ-0001') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001')).rejects.toThrow('connection lost')
    files.write = write
    await post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001')
    expect(files.json('/stock-moves/ADJ-0001')).toMatchObject({ quantity: '3' })
    expect(files.json('/inventory-adjustments/ADJ-0001')).toMatchObject({ status: 'applied', move: { path: '/stock-moves/ADJ-0001' } })
  })

  it('refuses a corrective-move name taken by something else', async () => {
    const files = stock({
      '/inventory-adjustments/ADJ-0001': adjustment({ countedQty: '23' }),
      '/stock-moves/ADJ-0001': move({ code: 'ADJ-0001' }),
    })
    await expect(post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001')).rejects.toThrow(/belongs to something else/)
    expect(files.json('/inventory-adjustments/ADJ-0001').status).toBe('draft')
  })

  it.each([
    ['no product', adjustment({ product: '' }), /Choose the product/],
    ['no warehouse', adjustment({ warehouse: '' }), /Choose the warehouse/],
    ['an unknown location', adjustment({ location: 'Mezzanine' }), /no counted location "Mezzanine"/],
    ['no date', adjustment({ date: '' }), /count date \(YYYY-MM-DD\) is required/],
    ['a malformed count', adjustment({ countedQty: '-1' }), /non-negative decimal/],
  ])('refuses to apply an adjustment with %s', async (_, value, error) => {
    const files = stock({ '/inventory-adjustments/ADJ-0001': value })
    await expect(post(files, 'apply-adjustment', '/inventory-adjustments/ADJ-0001')).rejects.toThrow(error)
    expect(files.json('/inventory-adjustments/ADJ-0001').status).toBe('draft')
  })

  it('only acts on records directly in its containers', async () => {
    await expect(post(stock(), 'post-move', '/inventory-adjustments/ADJ-0001')).rejects.toThrow(/directly in \/stock-moves/)
    await expect(post(stock(), 'post-move', '/stock-moves/a/b')).rejects.toThrow(/directly in \/stock-moves/)
    await expect(post(stock(), 'apply-adjustment', '/stock-moves/MOV-0001')).rejects.toThrow(/directly in \/inventory-adjustments/)
    await expect(post(stock(), 'delete', '/stock-moves/MOV-0001')).rejects.toThrow(/Unsupported operation/)
  })
})
