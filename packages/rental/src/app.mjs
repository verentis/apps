import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, invoicing,
  mimeTypes, productStatuses, recordKinds, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'rental-create'
export const postScript = 'scripts/post'
export const postScriptName = 'rental-post'
/** Where `spec.install` places the booking script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { product: 'rental products', booking: 'bookings' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number` })),
  { path: settingsPath, mode: 'read', reason: 'Default new bookings\' notes' },
]

/** What the booking script may touch: it validates bookings, computes totals and late fees and moves them through their statuses. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Read the currency and the daily late rate' },
  { path: containers.products.path, mode: 'read', reason: 'Check booked products, their rates and the quantity owned' },
  { path: containers.bookings.path, mode: 'write', reason: 'Confirm, pick up, return and cancel bookings, checking overlapping bookings' },
  { path: invoicing.invoices, mode: 'write', reason: 'Draft an invoice for a returned booking when Invoicing is installed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const humanized = value => value[0].toUpperCase() + value.slice(1).split('-').join(' ')

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  product: {
    singular: 'Rental product', plural: 'Rental products', titleKey: 'name', icon: 'lucide:package', status: 'status',
    folderNames: ['rental-products', 'rental'],
    sections: [
      { title: 'Rental product', fields: [
        text('name', 'Name', { required: true }),
        select('status', 'Status', productStatuses.map(value => ({ value, label: humanized(value) }))),
        text('dailyRate', 'Daily rate', { placeholder: '0.00', required: true }),
        text('deposit', 'Deposit', { placeholder: '0.00' }),
        { key: 'quantityOwned', label: 'Quantity owned', type: 'number', min: 0, max: 100000, required: true },
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
    ],
  },
  booking: {
    singular: 'Booking', plural: 'Bookings', titleKey: 'customerName', icon: 'lucide:calendar-check', status: 'status',
    folderNames: ['rental-bookings', 'rental'],
    sections: [
      { title: 'Customer', fields: [
        select('customerRef', 'CRM customer', '{{ data.customeroptions }}', { span: 2, description: 'Optional. Choose a CRM customer, then Copy name.' }),
        text('customerName', 'Customer name', { required: true })] },
      { title: 'Booking', fields: [
        select('product', 'Rental product', '{{ data.productoptions }}', { required: true }),
        { key: 'quantity', label: 'Quantity', type: 'number', min: 1, max: 100000, required: true },
        { key: 'startDate', label: 'Start date', type: 'date', required: true },
        { key: 'endDate', label: 'End date', type: 'date', required: true },
        text('dailyRate', 'Daily rate', { placeholder: 'Product rate', description: 'Leave empty to take the product\'s daily rate when confirming.' }),
        text('deposit', 'Deposit', { placeholder: 'Product deposit', description: 'Leave empty to take the product\'s deposit when confirming.' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', description: 'The currency drafted invoices use and the late fee per unit per day past a booking\'s end date. Number prefixes are app settings, managed with the installed app.', fields: [
    text('currency', 'Currency', { placeholder: 'ZAR' }),
    text('dailyLateRate', 'Daily late rate', { placeholder: '0.00' }),
    { key: 'notes', label: 'Booking notes', type: 'textarea', span: 2 }] },
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
    id: 'rental', name: 'Rental',
    description: "Manage rental bookings from availability checks to returns.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Rental cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Rental overview in Canvas", "caption": "Rental overview"}, {"source": "./marketplace/detail.png", "alt": "Bookings in Canvas", "caption": "Bookings"}],
    readme: "./marketplace/README.md",
    keywords: ['rental', 'rentals', 'bookings', 'hire', 'equipment', 'availability', 'invoicing'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Rental', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'bookings', 'display-name': 'Bookings', route: '/render?document=.%2Fcanvas%2Fbookings.page.yaml', order: 20 },
      { id: 'availability', 'display-name': 'Availability', route: '/render?document=.%2Fcanvas%2Favailability.page.yaml', order: 30 },
      { id: 'revenue', 'display-name': 'Revenue', route: '/render?document=.%2Fcanvas%2Frevenue.page.yaml', order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['rental.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'rental' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'rental' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Rental',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
