import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, inventory, mimeTypes, recordKinds,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'manufacturing-create'
export const postScript = 'scripts/post'
export const postScriptName = 'manufacturing-post'
/** Where `spec.install` places the production script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { bom: 'bills of materials', order: 'manufacturing orders' }

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = recordKinds.map(kind => ({
  path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code`,
}))

/**
 * What the production script may touch: it validates orders against their bill of materials, moves them through
 * their statuses, and emits consumption and production stock moves when Inventory is installed.
 */
export const postScriptFileAccess = [
  { path: containers.boms.path, mode: 'read', reason: 'Check the bill of materials a confirmed order builds' },
  { path: containers.orders.path, mode: 'write', reason: 'Confirm, start and complete manufacturing orders' },
  { path: inventory.moves, mode: 'write', reason: 'Emit consumption and production stock moves for completed orders when Inventory is installed' },
  { path: inventory.settingsPath, mode: 'read', reason: 'Stamp emitted stock moves with the Inventory default warehouse when it is set' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const qty = (key, label, extra = {}) => text(key, label, { placeholder: '0', ...extra })

const componentRows = {
  key: 'components', label: 'Components', type: 'rows', minimum: 1, maximum: 200, span: 2, addLabel: 'Add component',
  defaultRow: { product: '', name: '', quantity: '1' },
  fields: [
    { key: 'product', label: 'Product path', placeholder: '/products/PRD-0001', required: true },
    { key: 'name', label: 'Name' },
    { key: 'quantity', label: 'Quantity per output', required: true },
  ],
}

const routingRows = {
  key: 'routing', label: 'Operations', type: 'rows', minimum: 0, maximum: 100, span: 2, addLabel: 'Add operation',
  defaultRow: { operation: '', workcenter: '', minutes: '' },
  fields: [
    { key: 'operation', label: 'Operation', required: true },
    { key: 'workcenter', label: 'Workcenter' },
    { key: 'minutes', label: 'Minutes' },
  ],
}

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  bom: {
    singular: 'Bill of materials', plural: 'Bills of materials', titleKey: 'productName', icon: 'lucide:list-tree',
    folderNames: ['bills-of-materials', 'boms', 'manufacturing'],
    sections: [
      { title: 'Output', fields: [
        select('product', 'Product', '{{ data.productoptions }}', { span: 2, description: 'The product this BoM builds, from Inventory when it is installed.' }),
        text('productName', 'Product name', { required: true }),
        qty('outputQty', 'Output quantity', { required: true, description: 'How many units one run of this BoM produces.' })] },
      { title: 'Components', description: 'Quantities are per BoM output quantity. Confirming an order scales them to the quantity to produce.', fields: [componentRows] },
      { title: 'Routing', description: 'Optional operations in production order.', fields: [routingRows] },
      { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
  order: {
    singular: 'Manufacturing order', plural: 'Manufacturing orders', titleKey: 'productName', icon: 'lucide:factory', status: 'status',
    folderNames: ['manufacturing-orders', 'manufacturing'],
    sections: [
      { title: 'Order', fields: [
        select('bom', 'Bill of materials', '{{ data.bomoptions }}', { required: true, span: 2, description: 'Confirming snapshots the BoM product and computes the component demand.' }),
        qty('quantity', 'Quantity to produce', { required: true }),
        { key: 'scheduledDate', label: 'Scheduled date', type: 'date', required: true }] },
    ],
  },
}

/** `spec.settings`: code prefixes and width the create script reads through the engine SDK. */
export const settings = [
  ...Object.entries(codeSettings).map(([kind, setting]) => ({
    key: setting.key, 'display-name': setting.label, type: 'string', default: setting.default,
    description: `Prefix of generated ${entities[kind].singular.toLowerCase()} codes, e.g. ${setting.default}${'0'.repeat(codeDigits.default - 1)}1.`,
  })),
  { key: codeDigits.key, 'display-name': codeDigits.label, type: 'number', default: codeDigits.default,
    description: 'Minimum number of digits in generated codes (zero-padded).' },
]

/** `spec.creatables`: what the platform "New" menu offers in each container. All are named by the create script. */
export const creatables = recordKinds.map(kind => {
  const entity = entities[kind]
  return {
    id: kind, 'display-name': entity.singular, description: `A new ${entity.singular.toLowerCase()}`,
    icon: entity.icon, mime: mimeTypes[kind],
    parents: [containers[containerOf[kind]].mime],
    'folder-names': entity.folderNames,
    script: `./${createScript}`,
    template: `./templates/${kind}.json`,
  }
})

/** `spec.install`: managed app files under the install root, plus seeded (install-once, kept) data nodes. */
export const install = [
  { from: 'canvas/*.form.yaml', to: `${installRoot}/canvas/`, mode: 'managed', mime: 'application/vnd.verentis.canvas.form+yaml' },
  { from: 'canvas/*.page.yaml', to: `${installRoot}/canvas/`, mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' },
  { from: 'schemas/*.schema.json', to: `${installRoot}/schemas/`, mode: 'managed', mime: 'application/schema+json' },
  // Explicit MIME so placeholder templates are never classified as records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'manufacturing', name: 'Manufacturing',
    description: 'Bills of materials and manufacturing orders as files in your workspace, confirmed, started and completed by script, with stock moves handed to Inventory.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['manufacturing', 'mrp', 'production', 'bill of materials', 'bom', 'manufacturing orders', 'routing', 'workcenters'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Manufacturing', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'orders', 'display-name': 'Manufacturing orders', route: `/render?document=${encodeURIComponent('./canvas/orders.page.yaml')}`, order: 20 },
      { id: 'boms', 'display-name': 'Bills of materials', route: `/render?document=${encodeURIComponent('./canvas/boms.page.yaml')}`, order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['manufacturing.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/inventory', version: 'latest', optional: true },
    ],
    engine: 'verentis/nodejs',
    scripts: [createScript, postScript],
    install,
    creatables,
    sandbox: { 'allow-scripts': true, 'allow-same-origin': true, 'allow-forms': true, 'allow-popups': false },
  },
  packaging: {
    publisher: 'verentis',
    files: ['canvas/**', 'schemas/**', 'templates/**', 'seed/**', 'scripts/**', 'README.md'],
    // Bound Canvas documents carry their registration entry; `verentis pack` substitutes the origin.
    templates: ['canvas/*.yaml'],
    variables: { 'canvas-origin': canvasOrigin },
    encryption: 'none',
  },
}

export const featureOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'manufacturing' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'manufacturing' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Manufacturing',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
