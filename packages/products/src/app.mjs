import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, legacy, mimeTypes, productTypes, recordKinds,
  recordPath, starterRecords,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'products-create'
export const postScript = 'scripts/post'
export const postScriptName = 'products-post'
/** The API script: the operations other apps and agents call through the platform (api.yaml). */
export const apiScript = 'scripts/api'
export const apiScriptName = 'products-api'
/** Where `spec.install` places the maintenance script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new products create-only. */
export const createScriptFileAccess = [
  { path: containers.products.path, mode: 'write', reason: 'Create products with the next code' },
]

/** What the maintenance script may touch: it adopts product files Sales or Inventory kept before Products. */
export const postScriptFileAccess = [
  { path: containers.products.path, mode: 'write', reason: 'Adopt earlier Sales and Inventory products into the shared format' },
]

/** What the API script may touch: it creates and updates products other apps ask for, and finds them. */
export const apiScriptFileAccess = [
  { path: containers.products.path, mode: 'write', reason: 'Create and update the products other apps ask for' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const choice = value => ({ label: value[0].toUpperCase() + value.slice(1), value })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  product: {
    singular: 'Product', plural: 'Products', titleKey: 'name', icon: 'lucide:package',
    folderNames: ['products', 'catalog', 'catalogue'],
    sections: [
      { title: 'Product', fields: [
        text('name', 'Name', { required: true, span: 2 }),
        select('type', 'Type', productTypes.map(choice), { required: true, description: 'Goods are stocked; services are only sold.' }),
        text('sku', 'SKU', { placeholder: 'DESK-001' }),
        text('unit', 'Unit', { placeholder: 'ea' }),
        text('category', 'Category', { placeholder: 'Furniture' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
      { title: 'Selling', description: 'What Sales quotes by default.', fields: [
        text('listPrice', 'List price', { placeholder: '0.00' })] },
      { title: 'Stock', description: 'Inventory flags the product when on hand falls to this quantity.', fields: [
        text('reorderPoint', 'Reorder point', { placeholder: '0', visible: "form.values.type !== 'service'" })] },
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

/**
 * `spec.creatables`: what the platform "New" menu offers in each container. A /products folder Sales or Inventory
 * made before Products keeps its MIME, so it stays a valid parent.
 */
export const creatables = recordKinds.map(kind => {
  const entity = entities[kind]
  return {
    id: kind, 'display-name': entity.singular, description: `A new ${entity.singular.toLowerCase()}`,
    icon: entity.icon, mime: mimeTypes[kind],
    parents: [containers[containerOf[kind]].mime, ...legacy.container],
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
  ...starterRecords.map(record => ({ from: `seed/starter/${record.code}.json`, to: recordPath(record), mode: 'seed', mime: mimeTypes.product })),
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'products', name: 'Products',
    description: 'One product catalogue for every app: what you sell, stock and make.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: './icons/app.svg',
    hero: { source: './marketplace/hero.svg', alt: 'Products cover' },
    readme: './marketplace/README.md',
    keywords: ['products', 'catalogue', 'catalog', 'items', 'sku', 'price list', 'inventory', 'sales'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Products', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['products.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
    ],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'products' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'products' },
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
  app: 'Products',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
