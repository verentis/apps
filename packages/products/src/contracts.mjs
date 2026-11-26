// File-based Products record contracts: the one product catalogue every app shares. Products owns /products; Sales,
// Inventory, Manufacturing and others read these files and change them only through Products' API (api.yaml).
import {
  code, fillTemplate, money, optional, schemas as schemaKit, text,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/products'
export const schemaBase = 'https://schemas.verentis.io/products/v1'

/** Inventory (optional) keeps stock moves here; a product's form shows its stock when Inventory is installed. */
export const inventory = {
  moves: '/stock-moves',
  moveMime: 'application/vnd.verentis.inventory.move+json',
}

/**
 * Before Products, Sales and Inventory each kept their own product files in /products. Products adopts them into the
 * shared format (`adopt-products`); their containers stay valid parents for new products.
 */
export const legacy = {
  product: ['application/vnd.verentis.sales.product+json', 'application/vnd.verentis.inventory.product+json'],
  container: ['application/vnd.verentis.sales.products', 'application/vnd.verentis.inventory.products'],
}

const vendor = kind => `application/vnd.verentis.products.${kind}+json`

export const mimeTypes = {
  products: 'application/vnd.verentis.products.products',
  product: vendor('product'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  products: { path: '/products', mime: mimeTypes.products, holds: ['product'] },
}

/** Records are named by a generated code (`PRD-0001`) and stored without an extension in their container. */
export const recordKinds = ['product']
export const containerOf = { product: 'products' }

export const codeSettings = {
  product: { key: 'product-code-prefix', default: 'PRD-', label: 'Product code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Goods are stocked and moved; services are sold but never counted. */
export const productTypes = ['goods', 'service']

/** Quantities are exact non-negative decimal strings (`"12.5"`), like money, never JSON numbers. */
export const quantity = money

const { schemaId, recordSchema, recordTemplate } = schemaKit(schemaBase, 'Products')
export { schemaId }

/** The fields of a product other apps may set through the API (`create-product`, `update-product`). */
export const productFields = ['name', 'type', 'sku', 'unit', 'category', 'description', 'listPrice', 'reorderPoint']

export const schemas = {
  product: recordSchema('product', 'product', {
    code,
    name: text,
    type: { enum: productTypes },
    sku: optional(64),
    unit: optional(32),
    category: optional(100),
    description: optional(2000),
    listPrice: money,
    reorderPoint: quantity,
  }, ['code', ...productFields]),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code`.
 */
export const templates = {
  product: recordTemplate('product', {
    name: '{{ name }}', type: 'goods', sku: '', unit: 'ea', category: '', description: '', listPrice: '', reorderPoint: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {}

const seedTime = '2026-01-01T00:00:00Z'
const seeded = (codeValue, id, fields) => ({
  $schema: schemaId('product'), schemaVersion: 1, kind: 'product', id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, type: 'goods', description: '', ...fields,
})

/** A few sample products, seeded once (Inventory's sample stock moves refer to them). */
export const starterRecords = [
  seeded('PRD-0001', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c02', {
    name: 'Standing desk', sku: 'DESK-001', unit: 'ea', category: 'Furniture', listPrice: '450.00', reorderPoint: '5',
  }),
  seeded('PRD-0002', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c03', {
    name: 'Office chair', sku: 'CHAIR-001', unit: 'ea', category: 'Furniture', listPrice: '180.00', reorderPoint: '10',
  }),
  seeded('PRD-0003', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c04', {
    name: 'Copier paper A4', sku: 'PAPER-A4', unit: 'box', category: 'Supplies', listPrice: '6.50', reorderPoint: '20',
  }),
]
export const recordPath = record => `${containers.products.path}/${record.code}`

export { fillTemplate }
