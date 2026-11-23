import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, deliveryStatuses, installRoot, invoicing,
  mimeTypes, recordKinds, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'sales-create'
export const postScript = 'scripts/post'
export const postScriptName = 'sales-post'
/** Where `spec.install` places the confirm script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { product: 'products', quotation: 'quotations', order: 'sales orders' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number` })),
  { path: settingsPath, mode: 'read', reason: 'Default new quotations\' currency and notes' },
]

/** What the confirm script may touch: it validates a quotation, writes its sales order and marks it confirmed. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Default the currency when a quotation leaves it empty' },
  { path: containers.products.path, mode: 'read', reason: 'Check that quoted products exist and are active' },
  { path: containers.quotations.path, mode: 'write', reason: 'Mark quotations confirmed with their computed totals' },
  { path: containers.orders.path, mode: 'write', reason: 'Create the sales order a confirmed quotation becomes' },
  { path: invoicing.invoices, mode: 'write', reason: 'Draft an invoice for a confirmed quotation when Invoicing is installed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const humanized = value => value[0].toUpperCase() + value.slice(1).split('-').join(' ')

const partyFields = prefix => [
  text(`${prefix}.name`, 'Name', { required: prefix === 'customer' }), text(`${prefix}.legalName`, 'Legal name'),
  text(`${prefix}.email`, 'Email', { type: 'email' }), text(`${prefix}.phone`, 'Phone'),
  text(`${prefix}.taxIdentifier`, 'Tax number'),
  { key: `${prefix}.address.lines`, label: 'Street', type: 'text-list', span: 2 },
  text(`${prefix}.address.city`, 'City'), text(`${prefix}.address.region`, 'Region'),
  text(`${prefix}.address.postalCode`, 'Postal code'), text(`${prefix}.address.country`, 'Country code', { placeholder: 'ZA' }),
]

const quotedLines = {
  key: 'lines', label: 'Lines', type: 'rows', minimum: 1, maximum: 500, span: 2, addLabel: 'Add line',
  defaultRow: { product: '', description: '', quantity: '1', unitPrice: '', discount: '' },
  fields: [
    { key: 'product', label: 'Product', type: 'select', options: '{{ data.productoptions }}' },
    { key: 'description', label: 'Description', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'unitPrice', label: 'Unit price', required: true },
    { key: 'discount', label: 'Discount %' },
  ],
}
const linesSection = { title: 'Lines', description: 'Exact decimals. Each line is rounded to the cent; the discount is a percentage off the line.', fields: [quotedLines] }

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  product: {
    singular: 'Product', plural: 'Products', titleKey: 'name', icon: 'lucide:package',
    folderNames: ['products', 'sales'],
    sections: [
      { title: 'Product', fields: [
        text('name', 'Name', { required: true }), text('unit', 'Unit', { placeholder: 'each' }),
        text('listPrice', 'List price', { placeholder: '0.00' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
    ],
  },
  quotation: {
    singular: 'Quotation', plural: 'Quotations', titleKey: 'customer.name', icon: 'lucide:file-text', status: 'status',
    folderNames: ['quotations', 'sales'],
    sections: [
      { title: 'Customer', fields: [
        select('customerRef', 'CRM customer', '{{ data.customeroptions }}', { span: 2, description: 'Optional. Choose a CRM customer, then Copy details.' }),
        ...partyFields('customer')] },
      { title: 'Quotation', fields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('currency', 'Currency', { placeholder: 'ZAR', required: true }),
        text('reference', 'Customer reference', { placeholder: 'PO number' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
      linesSection,
    ],
  },
  order: {
    singular: 'Sales order', plural: 'Sales orders', titleKey: 'customer.name', icon: 'lucide:package-check', status: 'deliveryStatus',
    folderNames: ['sales-orders', 'sales'],
    sections: [
      { title: 'Order', fields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('currency', 'Currency', { placeholder: 'ZAR', required: true }),
        select('deliveryStatus', 'Delivery', deliveryStatuses.map(value => ({ value, label: humanized(value) }))),
        select('quotation', 'Quotation', '{{ data.quotationoptions }}'),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
      { title: 'Customer', fields: partyFields('customer') },
      linesSection,
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', description: 'What new quotations and sales orders start with. Number prefixes are app settings, managed with the installed app.', fields: [
    text('currency', 'Currency', { placeholder: 'ZAR' }),
    { key: 'notes', label: 'Quotation notes', type: 'textarea', span: 2 }] },
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
    id: 'sales', name: 'Sales',
    description: "Turn product quotations into confirmed sales orders.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Sales cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Sales overview in Canvas", "caption": "Sales overview"}, {"source": "./marketplace/detail.png", "alt": "Quotations in Canvas", "caption": "Quotations"}],
    readme: "./marketplace/README.md",
    keywords: ['sales', 'quotations', 'quotes', 'sales orders', 'products', 'crm', 'invoicing'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Sales', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'quotations', 'display-name': 'Quotations', route: '/render?document=.%2Fcanvas%2Fquotations.page.yaml', order: 20 },
      { id: 'orders', 'display-name': 'Sales orders', route: '/render?document=.%2Fcanvas%2Forders.page.yaml', order: 30 },
      { id: 'summary', 'display-name': 'Summary', route: '/render?document=.%2Fcanvas%2Fsummary.page.yaml', order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['sales.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'sales' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'sales' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Sales',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
