import { existsSync, readFileSync, readdirSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { apiContract } from '../../../tools/file-apps/build.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { featureOverlay, manifest, postScriptPath, productionOverlay, scriptConsents } from '../src/app.mjs'
import { containers, fillTemplate, legacy, mimeTypes, schemaId, schemas, starterRecords, templates } from '../src/contracts.mjs'
import { buildPages, documentFileAccess } from '../src/pages.mjs'
import { createProduct, findProducts, updateProduct } from '../scripts/api/main.mjs'
import { run } from '../scripts/post/main.mjs'

const root = new URL('../', import.meta.url)
const text = path => readFileSync(new URL(path, root), 'utf8')
const read = path => parse(text(path))
const plain = value => JSON.parse(JSON.stringify(value))
const documents = Object.fromEntries(readdirSync(new URL('canvas/', root)).map(name => [name, read(`canvas/${name}`)]))
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const valid = ajv.compile(schemas.product)
const now = '2026-03-10T08:00:00Z'
const settings = { get: () => undefined }
const context = files => ({ files, settings, caller: { app: 'sales' }, now })

describe('Products package', () => {
  it('is up to date with the generator', async () => {
    const pages = buildPages()
    expect(Object.keys(documents).sort()).toEqual(Object.keys(pages).sort())
    for (const [name, document] of Object.entries(pages)) expect(documents[name], name).toEqual(plain(document))
    const { metadata: { version: _version, ...metadata }, ...installed } = read('products.app.yaml')
    const { metadata: { version: _source, ...expectedMetadata }, ...expected } = plain({
      ...manifest, spec: { ...manifest.spec, 'file-access': [...documentFileAccess(pages), ...scriptConsents], api: await apiContract(root) },
    })
    expect({ ...installed, metadata }).toEqual({ ...expected, metadata: expectedMetadata })
    expect(read('environments/feature.yaml')).toEqual(featureOverlay)
    expect(read('environments/production.yaml')).toEqual(productionOverlay)
    expect(JSON.parse(text('schemas/product.schema.json'))).toEqual(plain(schemas.product))
  })

  it('seeds valid products and a template that validates once filled', () => {
    for (const record of starterRecords) {
      expect(valid(record), JSON.stringify(valid.errors)).toBe(true)
      expect(existsSync(new URL(`seed/starter/${record.code}.json`, root))).toBe(true)
    }
    const filled = { ...JSON.parse(fillTemplate(text('templates/product.json'), { id: '0b6f4c1e-8a7d-4f2b-9c3e-5d6a7b8c9d0e', now, name: 'Desk' })), code: 'PRD-0009' }
    expect(valid(filled), JSON.stringify(valid.errors)).toBe(true)
  })

  it('offers New in its own and in earlier Sales or Inventory /products folders', () => {
    const [product] = manifest.spec.creatables
    expect(product.parents).toEqual([containers.products.mime, ...legacy.container])
  })

  it('offers its operations to other apps and agents', async () => {
    const api = await apiContract(root)
    expect(api.operations.map(operation => [operation.key, operation.effect])).toEqual([
      ['create-product', 'write'], ['update-product', 'write'], ['find-products', 'read']])
    expect(manifest.spec.scripts).toContain('scripts/api')
  })

  it('reads stock from Inventory on the product form and adopts earlier products from the home page', () => {
    const form = documents['product.form.yaml']
    expect(form.spec.access.map(grant => grant.path)).toContain('/stock-moves')
    const home = JSON.stringify(documents['home.page.yaml'])
    expect(home).toContain('adopt-products')
    expect(home).toContain(postScriptPath)
  })
})

describe('Products API', () => {
  it('adds a product, once per SKU, in the shared format', async () => {
    const files = memoryFiles({})
    const added = await createProduct({ name: ' Desk ', sku: 'DESK-1', listPrice: '450' }, context(files))
    expect(added).toMatchObject({ path: '/products/PRD-0001', code: 'PRD-0001', name: 'Desk', created: true })
    const record = files.json('/products/PRD-0001')
    expect(valid(record), JSON.stringify(valid.errors)).toBe(true)
    expect(record).toMatchObject({ $schema: schemaId('product'), type: 'goods', unit: 'ea', listPrice: '450' })
    expect(await createProduct({ name: 'Desk again', sku: 'desk-1' }, context(files))).toMatchObject({ path: '/products/PRD-0001', created: false })
    expect((await createProduct({ name: 'Delivery', type: 'service' }, context(files))).code).toBe('PRD-0002')
    await expect(createProduct({ name: ' ' }, context(files))).rejects.toThrow(/name/)
    await expect(createProduct({ name: 'X', listPrice: '-1' }, context(files))).rejects.toThrow(/listPrice/)
  })

  it('changes given fields conditionally and refuses archived or earlier-format products', async () => {
    const files = memoryFiles({})
    await createProduct({ name: 'Chair' }, context(files))
    expect(await updateProduct({ path: '/products/PRD-0001', values: { reorderPoint: '10', name: 'Chair' } }, context(files)))
      .toMatchObject({ changed: ['reorderPoint'] })
    expect(files.json('/products/PRD-0001')).toMatchObject({ reorderPoint: '10', updatedAt: now })
    await expect(updateProduct({ path: '/invoices/INV-1', values: { name: 'X' } }, context(files))).rejects.toThrow(/Name a product/)
    files.write('/products/OLD-1', JSON.stringify({ kind: 'product', $schema: 'https://schemas.verentis.io/sales/v1/product.schema.json', code: 'OLD-1' }))
    await expect(updateProduct({ path: '/products/OLD-1', values: { name: 'X' } }, context(files))).rejects.toThrow(/Adopt it/)
  })

  it('finds products by text, SKU, category and type', async () => {
    const files = memoryFiles({})
    await createProduct({ name: 'Standing desk', sku: 'DESK-1', category: 'Furniture' }, context(files))
    await createProduct({ name: 'Delivery', type: 'service' }, context(files))
    expect((await findProducts({ query: 'desk' }, context(files))).products.map(p => p.code)).toEqual(['PRD-0001'])
    expect((await findProducts({ category: 'furniture' }, context(files))).total).toBe(1)
    expect((await findProducts({ type: 'service' }, context(files))).products[0].name).toBe('Delivery')
    expect((await findProducts({}, context(files))).total).toBe(2)
  })
})

describe('Adopting earlier products', () => {
  it('rewrites Sales and Inventory product files in the shared format at the same path', async () => {
    const files = memoryFiles({})
    await files.write('/products/PROD-0001', JSON.stringify({ $schema: 'https://schemas.verentis.io/sales/v1/product.schema.json', schemaVersion: 1, kind: 'product',
      id: '0b6f4c1e-8a7d-4f2b-9c3e-5d6a7b8c9d01', state: 'active', createdAt: now, updatedAt: now, code: 'PROD-0001', name: 'Consulting', unit: 'hour', listPrice: '95', description: 'Per hour' }),
    { contentType: legacy.product[0] })
    await files.write('/products/PRD-0001', JSON.stringify({ $schema: 'https://schemas.verentis.io/inventory/v1/product.schema.json', schemaVersion: 1, kind: 'product',
      id: '0b6f4c1e-8a7d-4f2b-9c3e-5d6a7b8c9d02', state: 'active', createdAt: now, updatedAt: now, code: 'PRD-0001', name: 'Desk', sku: 'D-1', unit: 'ea', category: 'Furniture', reorderPoint: '5' }),
    { contentType: legacy.product[1] })
    const result = await run({ operation: 'adopt-products' }, files, { now })
    expect(result.adopted).toEqual(['/products/PROD-0001', '/products/PRD-0001'])
    for (const path of result.adopted) {
      expect(valid(files.json(path)), JSON.stringify(valid.errors)).toBe(true)
      expect((await files.stat(path)).contentType).toBe(mimeTypes.product)
    }
    expect(files.json('/products/PROD-0001')).toMatchObject({ code: 'PROD-0001', listPrice: '95', unit: 'hour', description: 'Per hour', reorderPoint: '' })
    expect(files.json('/products/PRD-0001')).toMatchObject({ sku: 'D-1', category: 'Furniture', reorderPoint: '5', listPrice: '' })
    expect((await run({ operation: 'adopt-products' }, files, { now })).message).toMatch(/already in the shared format/)
  })
})
