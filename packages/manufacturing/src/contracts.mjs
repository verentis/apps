// File-based Manufacturing record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, checklistItem, code, fileReference, fillTemplate, money, object, optional, optionalDate, pathOrEmpty, schemas as schemaKit, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/manufacturing'
export const schemaBase = 'https://schemas.verentis.io/manufacturing/v1'

/**
 * Products (optional) keeps the product catalogue; BoM components and outputs reference its products.
 */
export const products = {
  path: '/products',
  mime: 'application/vnd.verentis.products.product+json',
}

/**
 * Inventory (optional) keeps stock moves here; completing a manufacturing order emits consumption and production moves in Inventory's move vendor MIME
 * format when the /stock-moves container exists.
 */
export const inventory = {
  moves: '/stock-moves',
  settingsPath: '/settings/inventory.json',
  moveMime: 'application/vnd.verentis.inventory.move+json',
  moveSchema: 'https://schemas.verentis.io/inventory/v1/move.schema.json',
}

const vendor = kind => `application/vnd.verentis.manufacturing.${kind}+json`

export const mimeTypes = {
  boms: 'application/vnd.verentis.manufacturing.boms',
  orders: 'application/vnd.verentis.manufacturing.orders',
  bom: vendor('bom'),
  order: vendor('order'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  boms: { path: '/bills-of-materials', mime: mimeTypes.boms, holds: ['bom'] },
  orders: { path: '/manufacturing-orders', mime: mimeTypes.orders, holds: ['order'] },
}

/** Records are named by a generated code (`MO-0001`) and stored without an extension in their container. */
export const recordKinds = ['bom', 'order']
export const containerOf = { bom: 'boms', order: 'orders' }

export const codeSettings = {
  bom: { key: 'bom-code-prefix', default: 'BOM-', label: 'Bill of materials code prefix' },
  order: { key: 'order-code-prefix', default: 'MO-', label: 'Manufacturing order code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** A manufacturing order moves forward only: confirming computes demand, completing emits the stock moves. */
export const orderStatuses = ['draft', 'confirmed', 'in-progress', 'done', 'cancelled']

const { schemaId, recordSchema, recordTemplate } = schemaKit(schemaBase, 'Manufacturing')
export { schemaId }

/** Quantities are exact non-negative decimal strings (`"12.5"`), like money, never JSON numbers. */
export const quantity = money

/** One component line: a product reference (Inventory's when installed), its name and the quantity per BoM output. */
export const component = object({
  product: pathOrEmpty,
  name: optional(200),
  quantity,
}, ['product', 'name', 'quantity'])

/** One routing step: the operation, the workcenter doing it and the expected minutes. */
export const routingStep = object({
  operation: optional(200),
  workcenter: optional(200),
  minutes: quantity,
}, ['operation', 'workcenter', 'minutes'])

// Draft records may be incomplete on disk (a generated record opens straight into its form); confirming checks them.
// A bill of materials is active or archived through the record `state`; archived BoMs cannot be confirmed against.
export const schemas = {
  bom: recordSchema('bom', 'bill of materials', {
    code,
    product: pathOrEmpty,
    productName: optional(200),
    outputQty: quantity,
    components: array(component, 0, 200),
    routing: array(routingStep, 0, 100),
    notes: optional(10000),
  }, ['code', 'product', 'productName', 'outputQty', 'components', 'routing', 'notes']),
  order: recordSchema('order', 'manufacturing order', {
    code,
    bom: pathOrEmpty,
    product: pathOrEmpty,
    productName: optional(200),
    quantity,
    scheduledDate: optionalDate,
    demand: array(component, 0, 200),
    status: { enum: orderStatuses },
    confirmedAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    cancelledAt: timestamp,
    moves: array(fileReference, 0, 250),
    // The shop floor ticks and times the BoM's operations on the order.
    operations: array(checklistItem, 0, 100),
  }, ['code', 'bom', 'quantity', 'scheduledDate', 'demand', 'status'], [
    whenStatus(['confirmed', 'in-progress', 'done'], ['confirmedAt', 'product', 'productName']),
    whenStatus(['in-progress', 'done'], ['startedAt']),
    whenStatus(['done'], ['completedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills an empty scheduled date with today.
 */
export const templates = {
  bom: recordTemplate('bom', {
    product: '', productName: '{{ name }}', outputQty: '1',
    components: [{ product: '', name: '', quantity: '1' }], routing: [], notes: '',
  }),
  order: recordTemplate('order', {
    bom: '', product: '', productName: '', quantity: '1', scheduledDate: '', demand: [], status: 'draft', operations: [],
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  order: { scheduledDate: 'today' },
}

export { fillTemplate }
