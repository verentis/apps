// File-based Inventory record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fileReference, fillTemplate, money, optional, optionalDate, pathOrEmpty,
  schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/inventory'
export const schemaBase = 'https://schemas.verentis.io/inventory/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the stock data.
export const settingsPath = '/settings/inventory.json'

const vendor = kind => `application/vnd.verentis.inventory.${kind}+json`

export const mimeTypes = {
  products: 'application/vnd.verentis.inventory.products',
  warehouses: 'application/vnd.verentis.inventory.warehouses',
  moves: 'application/vnd.verentis.inventory.moves',
  adjustments: 'application/vnd.verentis.inventory.adjustments',
  product: vendor('product'),
  warehouse: vendor('warehouse'),
  move: vendor('move'),
  adjustment: vendor('adjustment'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  products: { path: '/products', mime: mimeTypes.products, holds: ['product'] },
  warehouses: { path: '/warehouses', mime: mimeTypes.warehouses, holds: ['warehouse'] },
  moves: { path: '/stock-moves', mime: mimeTypes.moves, holds: ['move'] },
  adjustments: { path: '/inventory-adjustments', mime: mimeTypes.adjustments, holds: ['adjustment'] },
}

/** Records are named by a generated code (`MOV-0001`) and stored without an extension in their container. */
export const recordKinds = ['product', 'warehouse', 'move', 'adjustment']
export const containerOf = { product: 'products', warehouse: 'warehouses', move: 'moves', adjustment: 'adjustments' }

export const codeSettings = {
  product: { key: 'product-code-prefix', default: 'PRD-', label: 'Product code prefix' },
  warehouse: { key: 'warehouse-code-prefix', default: 'WH-', label: 'Warehouse code prefix' },
  move: { key: 'move-code-prefix', default: 'MOV-', label: 'Stock move code prefix' },
  adjustment: { key: 'adjustment-code-prefix', default: 'ADJ-', label: 'Adjustment code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Inventory')
export { schemaId }

/** Quantities are exact non-negative decimal strings (`"12.5"`), like money, never JSON numbers. */
export const quantity = money

// Draft records may be incomplete on disk (a generated record opens straight into its form); posting checks them.
export const schemas = {
  product: recordSchema('product', 'product', {
    code,
    name: text,
    sku: optional(64),
    unit: optional(32),
    category: optional(100),
    reorderPoint: quantity,
  }, ['code', 'name', 'sku', 'unit', 'category', 'reorderPoint']),
  warehouse: recordSchema('warehouse', 'warehouse', {
    code,
    name: text,
    locations: array({ type: 'string', minLength: 1, maxLength: 100 }, 0, 100),
  }, ['code', 'name', 'locations']),
  move: recordSchema('move', 'stock move', {
    code,
    product: pathOrEmpty,
    quantity,
    fromWarehouse: pathOrEmpty,
    fromLocation: optional(100),
    toWarehouse: pathOrEmpty,
    toLocation: optional(100),
    date: optionalDate,
    reference: optional(200),
    status: { enum: ['draft', 'done'] },
    postedAt: timestamp,
    source: fileReference,
  }, ['code', 'product', 'quantity', 'fromWarehouse', 'fromLocation', 'toWarehouse', 'toLocation', 'date', 'reference', 'status'], [
    whenStatus(['done'], ['postedAt']),
  ]),
  adjustment: recordSchema('adjustment', 'inventory adjustment', {
    code,
    product: pathOrEmpty,
    warehouse: pathOrEmpty,
    location: optional(100),
    countedQty: quantity,
    date: optionalDate,
    status: { enum: ['draft', 'applied'] },
    appliedAt: timestamp,
    move: fileReference,
  }, ['code', 'product', 'warehouse', 'location', 'countedQty', 'date', 'status'], [
    whenStatus(['applied'], ['appliedAt']),
  ]),
  settings: settingsSchema({
    defaultWarehouse: pathOrEmpty,
  }, ['defaultWarehouse']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills an empty date with today and an empty warehouse with the default warehouse.
 */
export const templates = {
  product: recordTemplate('product', { name: '{{ name }}', sku: '', unit: 'ea', category: '', reorderPoint: '' }),
  warehouse: recordTemplate('warehouse', { name: '{{ name }}', locations: [] }),
  move: recordTemplate('move', {
    product: '', quantity: '', fromWarehouse: '', fromLocation: '', toWarehouse: '', toLocation: '',
    date: '', reference: '{{ name }}', status: 'draft',
  }),
  adjustment: recordTemplate('adjustment', {
    product: '', warehouse: '', location: '', countedQty: '', date: '', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  move: { date: 'today' },
  adjustment: { date: 'today', warehouse: { file: settingsPath, pointer: 'defaultWarehouse' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const seeded = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** A sample warehouse, a few products and opening stock moves, seeded once. */
export const starterRecords = [
  seeded('warehouse', 'WH-0001', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c01', {
    name: 'Main warehouse', locations: ['Stock', 'Input', 'Output'],
  }),
  seeded('product', 'PRD-0001', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c02', {
    name: 'Standing desk', sku: 'DESK-001', unit: 'ea', category: 'Furniture', reorderPoint: '5',
  }),
  seeded('product', 'PRD-0002', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c03', {
    name: 'Office chair', sku: 'CHAIR-001', unit: 'ea', category: 'Furniture', reorderPoint: '10',
  }),
  seeded('product', 'PRD-0003', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c04', {
    name: 'Copier paper A4', sku: 'PAPER-A4', unit: 'box', category: 'Supplies', reorderPoint: '20',
  }),
  seeded('move', 'MOV-0001', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c05', {
    product: '/products/PRD-0001', quantity: '20', fromWarehouse: '', fromLocation: '',
    toWarehouse: '/warehouses/WH-0001', toLocation: 'Stock',
    date: '2026-01-02', reference: 'Initial receipt', status: 'done', postedAt: seedTime,
  }),
  seeded('move', 'MOV-0002', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c06', {
    product: '/products/PRD-0002', quantity: '50', fromWarehouse: '', fromLocation: '',
    toWarehouse: '/warehouses/WH-0001', toLocation: 'Stock',
    date: '2026-01-02', reference: 'Initial receipt', status: 'done', postedAt: seedTime,
  }),
  seeded('move', 'MOV-0003', '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c07', {
    product: '/products/PRD-0001', quantity: '4', fromWarehouse: '/warehouses/WH-0001', fromLocation: 'Stock',
    toWarehouse: '', toLocation: '',
    date: '2026-01-05', reference: 'Showroom delivery', status: 'draft',
  }),
]
export const recordPath = record => `${containers[containerOf[record.kind]].path}/${record.code}`

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultWarehouse: '/warehouses/WH-0001',
}

export { fillTemplate }
