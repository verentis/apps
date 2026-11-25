import { codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds, products, recordPath, settingsPath, starterRecords } from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'inventory-create'
export const postScript = 'scripts/post'
export const postScriptName = 'inventory-post'
/** The API script: the operations other apps call through the platform (api.yaml). */
export const apiScript = 'scripts/api'
export const apiScriptName = 'inventory-api'
/** Where `spec.install` places the posting script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`
/** The Canvas page behind the "Low stock" dashboard widget. */
export const lowStockWidgetFile = 'low-stock.widget.page.yaml'

/** What the create script may touch: it writes new records create-only and reads the default warehouse. */
/** What the API script may touch: it records other apps' production as stock moves through the default warehouse. */
export const apiScriptFileAccess = [
  { path: containers.moves.path, mode: 'write', reason: 'Record production other apps report as done stock moves' },
  { path: settingsPath, mode: 'read', reason: 'Move production through the default warehouse' },
]

export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({
    path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${kind === 'warehouse' ? 'warehouses' : `${kind}s`} with the next code`,
  })),
  { path: settingsPath, mode: 'read', reason: 'Default new adjustments to the default warehouse' },
]

/** What the posting script may touch: it validates products and warehouses, marks moves done and applies counts. */
export const postScriptFileAccess = [
  { path: products.path, mode: 'read', reason: 'Check that the moved or counted product exists and is active (Products)' },
  { path: containers.warehouses.path, mode: 'read', reason: 'Check warehouses and their locations' },
  { path: containers.moves.path, mode: 'write', reason: 'Mark moves done and write corrective moves for applied adjustments' },
  { path: containers.adjustments.path, mode: 'write', reason: 'Mark adjustments applied' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const qty = (key, label, extra = {}) => text(key, label, { placeholder: '0', ...extra })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  warehouse: {
    singular: 'Warehouse', plural: 'Warehouses', titleKey: 'name', icon: 'lucide:warehouse',
    folderNames: ['warehouses', 'inventory'],
    sections: [{ title: 'Warehouse', fields: [
      text('name', 'Name', { required: true, span: 2 }),
      { key: 'locations', label: 'Locations', type: 'text-list', span: 2,
        description: 'Named locations inside this warehouse, e.g. Stock, Input, Output. Moves into a warehouse with locations must use one of them.' },
    ] }],
  },
  move: {
    singular: 'Stock move', plural: 'Stock moves', titleKey: 'reference', icon: 'lucide:arrow-left-right', status: 'status',
    folderNames: ['stock-moves', 'moves', 'inventory'],
    sections: [
      { title: 'Move', fields: [
        select('product', 'Product', '{{ data.productoptions }}', { required: true }),
        qty('quantity', 'Quantity', { required: true }),
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('reference', 'Reference', { placeholder: 'PO-1234' }),
      ] },
      { title: 'From', description: 'Leave empty for receipts from outside the workspace.', fields: [
        select('fromWarehouse', 'Warehouse', '{{ data.warehouseoptions }}'), text('fromLocation', 'Location', { placeholder: 'Stock' }),
      ] },
      { title: 'To', description: 'Leave empty for deliveries out of the workspace.', fields: [
        select('toWarehouse', 'Warehouse', '{{ data.warehouseoptions }}'), text('toLocation', 'Location', { placeholder: 'Stock' }),
      ] },
    ],
  },
  adjustment: {
    singular: 'Inventory adjustment', plural: 'Inventory adjustments', titleKey: 'code', icon: 'lucide:clipboard-check', status: 'status',
    folderNames: ['inventory-adjustments', 'adjustments', 'inventory'],
    sections: [{ title: 'Count', fields: [
      select('product', 'Product', '{{ data.productoptions }}', { required: true }),
      select('warehouse', 'Warehouse', '{{ data.warehouseoptions }}', { required: true }),
      text('location', 'Location', { placeholder: 'Stock' }),
      qty('countedQty', 'Counted quantity', { required: true }),
      { key: 'date', label: 'Date', type: 'date', required: true },
    ] }],
  },
}

export const settingsFields = [
  select('defaultWarehouse', 'Default warehouse', '{{ data.warehouseoptions }}',
    { description: 'New inventory adjustments count this warehouse by default.' }),
]

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
  ...starterRecords.map(record => ({ from: `seed/starter/${record.code}.json`, to: recordPath(record), mode: 'seed', mime: mimeTypes[record.kind] })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

/** `spec.widgets`: tiles the workspace dashboard offers, rendered by Canvas with `context.surface === 'widget'`. */
export const widgets = [
  {
    id: 'low-stock', 'display-name': 'Low stock', description: 'Products at or below their reorder point, from done stock moves',
    route: `/render?document=${encodeURIComponent(`./canvas/${lowStockWidgetFile}`)}`,
    'default-size': { w: 4, h: 4 }, 'min-size': { w: 3, h: 3 },
  },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'inventory', name: 'Inventory',
    description: "See which products are on hand and where they are stored.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Inventory cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Inventory overview in Canvas", "caption": "Inventory overview"}, {"source": "./marketplace/detail.png", "alt": "Stock levels in Canvas", "caption": "Stock levels"}],
    readme: "./marketplace/README.md",
    keywords: ['inventory', 'stock', 'warehouse', 'products', 'stock moves', 'inventory adjustments', 'on hand', 'reorder point'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Inventory', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'stock', 'display-name': 'Stock levels', route: '/render?document=.%2Fcanvas%2Fstock.page.yaml', order: 20 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    widgets,
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['inventory.default'],
    settings,
    // Products owns the catalogue Inventory stocks; installing Inventory installs it.
    dependencies: [{ package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' }, { package: 'verentis/products', version: 'latest' }],
    engine: 'verentis/nodejs',
    scripts: [createScript, postScript, apiScript],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'inventory' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'inventory' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
  ...scriptConsent(apiScriptName, apiScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Inventory',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
