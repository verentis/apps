import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, invoicing, mimeTypes, recordKinds,
  settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'purchase-create'
export const postScript = 'scripts/post'
export const postScriptName = 'purchase-post'
/** Where `spec.install` places the order script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { vendor: 'vendors', order: 'purchase orders' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number` })),
  { path: settingsPath, mode: 'read', reason: 'Default new purchase orders\' dates, currency and notes' },
]

/** What the order script may touch: it validates orders against their vendor, marks them confirmed or received, and drafts vendor bills. */
export const postScriptFileAccess = [
  { path: containers.vendors.path, mode: 'read', reason: 'Check the vendor a confirmed order buys from' },
  { path: containers.orders.path, mode: 'write', reason: 'Mark purchase orders confirmed or received' },
  { path: invoicing.invoices, mode: 'write', reason: 'Draft a vendor bill for a received order when Invoicing is installed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })

const orderLines = {
  key: 'lines', label: 'Lines', type: 'rows', minimum: 1, maximum: 500, span: 2, addLabel: 'Add line',
  defaultRow: { description: '', quantity: '1', unitPrice: '' },
  fields: [
    { key: 'description', label: 'Description', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'unitPrice', label: 'Unit price', required: true },
  ],
}

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  vendor: {
    singular: 'Vendor', plural: 'Vendors', titleKey: 'name', icon: 'lucide:building-2',
    folderNames: ['vendors', 'purchase'],
    sections: [
      { title: 'Vendor', fields: [
        text('name', 'Name', { required: true }), text('legalName', 'Legal name'),
        text('contactName', 'Contact person'), text('email', 'Email', { type: 'email' }),
        text('phone', 'Phone'), text('taxIdentifier', 'Tax number'),
        { key: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number', min: 0, max: 365, required: true },
        text('currency', 'Currency', { placeholder: 'ZAR' })] },
      { title: 'Address', fields: [
        { key: 'address.lines', label: 'Street', type: 'text-list', span: 2 },
        text('address.city', 'City'), text('address.region', 'Region'),
        text('address.postalCode', 'Postal code'), text('address.country', 'Country code', { placeholder: 'ZA' })] },
      { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
  order: {
    singular: 'Purchase order', plural: 'Purchase orders', titleKey: 'vendorName', icon: 'lucide:shopping-cart', status: 'status',
    folderNames: ['purchase-orders', 'purchase'],
    sections: [
      { title: 'Vendor', fields: [
        select('vendor', 'Vendor', '{{ data.vendoroptions }}', { required: true, span: 2, description: 'Confirming snapshots the vendor\'s name onto the order.' }),
        text('reference', 'Vendor reference', { placeholder: 'Quote number' })] },
      { title: 'Order', fields: [
        { key: 'orderDate', label: 'Order date', type: 'date', required: true },
        { key: 'expectedDate', label: 'Expected date', type: 'date', required: true },
        text('currency', 'Currency', { placeholder: 'ZAR', required: true }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
      { title: 'Lines', description: 'Exact decimals. Confirming rounds each line to the cent and computes the total.', fields: [orderLines] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', description: 'Values new purchase orders start with. Number prefixes are app settings, managed with the installed app.', fields: [
    text('defaultCurrency', 'Default currency', { placeholder: 'ZAR' }),
    { key: 'defaultLeadDays', label: 'Expected lead time (days)', type: 'number', min: 0, max: 365, required: true },
    { key: 'notes', label: 'Order notes', type: 'textarea', span: 2 }] },
]

/** `spec.settings`: number prefixes and width the create script reads through the engine SDK. */
export const settings = [
  ...Object.entries(codeSettings).map(([kind, setting]) => ({
    key: setting.key, 'display-name': setting.label, type: 'string', default: setting.default,
    description: `Prefix of generated ${entities[kind].singular.toLowerCase()} numbers, e.g. ${setting.default}${'0'.repeat(codeDigits.default - 1)}1.`,
  })),
  { key: codeDigits.key, 'display-name': codeDigits.label, type: 'number', default: codeDigits.default,
    description: 'Minimum number of digits in generated numbers (zero-padded).' },
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
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'purchase', name: 'Purchase',
    description: 'Vendors and purchase orders as files in your workspace, confirmed and received by script, with draft vendor bills handed to Invoicing.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['purchase', 'purchasing', 'procurement', 'vendors', 'purchase orders', 'rfq', 'vendor bills'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Purchase', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'vendors', 'display-name': 'Vendors', route: `/render?document=${encodeURIComponent('./canvas/vendors.page.yaml')}`, order: 20 },
      { id: 'orders', 'display-name': 'Purchase orders', route: `/render?document=${encodeURIComponent('./canvas/orders.page.yaml')}`, order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['purchase.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/invoicing', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'purchase' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'purchase' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Purchase',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
