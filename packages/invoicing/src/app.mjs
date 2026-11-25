import { callingCode } from '../../../tools/file-apps/canvas.mjs'
import {
  accounting, accountingSettingsPath, codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot,
  mimeTypes, paymentMethods, recordKinds, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.2.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'invoicing-create'
export const postScript = 'scripts/post'
export const postScriptName = 'invoicing-post'
/** The API script: the operations other apps call through the platform (api.yaml). */
export const apiScript = 'scripts/api'
export const apiScriptName = 'invoicing-api'
/** Where `spec.install` places the posting script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`
/** The Canvas page behind the "Invoices due" dashboard widget. */
export const dueWidgetFile = 'due.widget.page.yaml'
/** Where app-owned window layouts register: the workspace desktop folder of this app. */
export const desktopFolder = '/.workspace/desktop/apps/invoicing/'

const plural = { invoice: 'invoices', credit: 'credit notes', payment: 'payments' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number` })),
  { path: settingsPath, mode: 'read', reason: 'Default new invoices\' due date and notes, and payments\' bank account' },
  { path: accountingSettingsPath, mode: 'read', reason: 'Default new records to the ledger\'s base currency' },
]

/** What the API script may touch: it drafts invoices other apps ask for, numbered like any new invoice. */
export const apiScriptFileAccess = [
  { path: containers.invoices.path, mode: 'write', reason: 'Draft invoices other apps ask for, with the next number' },
]

/** What the posting script may touch: it checks against the ledger (Accounting posts the journals) and marks records issued or posted. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Read the seller details and posting accounts' },
  { path: accountingSettingsPath, mode: 'read', reason: 'Read the ledger\'s base currency and precision' },
  { path: accounting.accounts, mode: 'read', reason: 'Check that posted accounts exist and are active' },
  { path: accounting.periods, mode: 'read', reason: 'Find the open period a posting date falls in' },
  { path: containers.invoices.path, mode: 'write', reason: 'Mark invoices issued and store their document copy' },
  { path: containers.credits.path, mode: 'write', reason: 'Mark credit notes issued and store their document copy' },
  { path: containers.payments.path, mode: 'write', reason: 'Mark payments posted or reversed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const humanized = value => value[0].toUpperCase() + value.slice(1).split('-').join(' ')

const partyFields = prefix => [
  text(`${prefix}.name`, 'Name', { required: prefix === 'customer' }), text(`${prefix}.legalName`, 'Legal name'),
  text(`${prefix}.email`, 'Email', { type: 'email' }),
  // Stored in international form once complete; a national number takes the country's calling code.
  { key: `${prefix}.phone`, label: 'Phone', type: 'phone', defaultCode: callingCode(`form.values.${prefix} && form.values.${prefix}.address && form.values.${prefix}.address.country`) },
  text(`${prefix}.taxIdentifier`, 'Tax number'),
  { key: `${prefix}.address`, label: 'Address', type: 'address', span: 2 },
]

const billedLines = {
  key: 'lines', label: 'Lines', type: 'rows', minimum: 1, maximum: 500, span: 2, addLabel: 'Add line',
  defaultRow: { description: '', quantity: '1', unitPrice: '', taxRate: '' },
  fields: [
    { key: 'description', label: 'Description', required: true },
    { key: 'quantity', label: 'Quantity', required: true },
    { key: 'unitPrice', label: 'Unit price', required: true },
    { key: 'taxRate', label: 'Tax %' },
  ],
}
const linesSection = { title: 'Lines', description: 'Exact decimals. Each line is rounded to the cent; an empty tax rate takes the default from Invoicing settings.', fields: [billedLines] }

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  invoice: {
    singular: 'Invoice', plural: 'Invoices', titleKey: 'customer.name', icon: 'lucide:file-text', status: 'status',
    folderNames: ['invoices', 'invoicing'],
    sections: [
      { title: 'Customer', fields: [
        select('customerRef', 'CRM customer', '{{ data.customeroptions }}', { span: 2, description: 'Optional. Choose a CRM customer, then Copy details.' }),
        ...partyFields('customer')] },
      { title: 'Invoice', fields: [
        { key: 'issueDate', label: 'Issue date', type: 'date', required: true }, { key: 'dueDate', label: 'Due date', type: 'date', required: true },
        text('currency', 'Currency', { placeholder: 'ZAR', required: true }), text('reference', 'Customer reference', { placeholder: 'PO number' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
      linesSection,
    ],
  },
  credit: {
    singular: 'Credit note', plural: 'Credit notes', titleKey: 'reason', icon: 'lucide:file-minus', status: 'status',
    folderNames: ['credit-notes', 'invoicing'],
    sections: [
      { title: 'Credit note', fields: [
        select('invoice', 'Invoice', '{{ data.invoiceoptions }}', { required: true, span: 2 }),
        { key: 'date', label: 'Date', type: 'date', required: true }, text('currency', 'Currency', { placeholder: 'ZAR', required: true }),
        text('reason', 'Reason', { required: true, span: 2 })] },
      linesSection,
    ],
  },
  payment: {
    singular: 'Payment', plural: 'Payments', titleKey: 'reference', icon: 'lucide:banknote', status: 'status',
    folderNames: ['payments', 'invoicing'],
    sections: [
      { title: 'Payment', fields: [
        { key: 'date', label: 'Date received', type: 'date', required: true },
        select('method', 'Method', paymentMethods.map(value => ({ value, label: humanized(value) }))),
        text('currency', 'Currency', { placeholder: 'ZAR', required: true }), text('amount', 'Amount', { placeholder: '0.00', required: true }),
        text('payer', 'Payer'), text('reference', 'Reference'),
        select('bankAccount', 'Received into', '{{ data.bankaccountoptions }}', { required: true, span: 2 })] },
      { title: 'Allocations', description: 'Settle issued invoices. Anything unallocated stays on account in receivables.', fields: [
        { key: 'allocations', label: 'Allocations', type: 'rows', maximum: 500, span: 2, addLabel: 'Allocate to an invoice',
          defaultRow: { invoice: '', amount: '' },
          fields: [
            { key: 'invoice', label: 'Invoice', type: 'select', required: true, options: '{{ data.invoiceoptions }}' },
            { key: 'amount', label: 'Amount', required: true },
          ] }] },
    ],
  },
}

const accountSelect = (key, label) => select(key, label, '{{ data.accountoptions }}', { required: true })
export const settingsSections = [
  { title: 'Seller', description: 'Your details as printed on invoices. Each invoice keeps a copy as it was when issued.', fields: partyFields('seller') },
  { title: 'Defaults', fields: [
    { key: 'defaultDueDays', label: 'Payment terms (days)', type: 'number', min: 0, max: 365, required: true },
    text('defaultTaxRate', 'Default tax rate (%)', { required: true }),
    { key: 'notes', label: 'Invoice notes', type: 'textarea', span: 2 }] },
  { title: 'Posting accounts', description: 'Accounts in the Accounting chart of accounts that invoices, credit notes and payments post to.', fields: [
    accountSelect('receivableAccount', 'Accounts receivable'), accountSelect('incomeAccount', 'Sales income'),
    accountSelect('taxAccount', 'Sales tax'), accountSelect('bankAccount', 'Default bank account')] },
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
  // Window layouts are manifests the workspace registers from its desktop folder; managed, so users save a copy to change one.
  { from: 'desktop/*.layout.yaml', to: desktopFolder, mode: 'managed' },
]

/** `spec.widgets`: tiles the workspace dashboard offers, rendered by Canvas with `context.surface === 'widget'`. */
export const widgets = [
  {
    id: 'invoices-due', 'display-name': 'Invoices due', description: 'Open and overdue invoices by due date',
    route: `/render?document=${encodeURIComponent(`./canvas/${dueWidgetFile}`)}`,
    'default-size': { w: 4, h: 4 }, 'min-size': { w: 3, h: 3 },
  },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'invoicing', name: 'Invoicing',
    description: "Issue customer invoices and see what is still owed.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Invoicing cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Invoicing overview in Canvas", "caption": "Invoicing overview"}, {"source": "./marketplace/detail.png", "alt": "Receivables in Canvas", "caption": "Receivables"}],
    readme: "./marketplace/README.md",
    keywords: ['invoicing', 'invoices', 'credit notes', 'payments', 'receivables', 'billing', 'accounting'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Invoicing', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'receivables', 'display-name': 'Receivables', route: '/render?document=.%2Fcanvas%2Freceivables.page.yaml', order: 20 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    widgets,
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['invoicing.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/accounting', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
    ],
    engine: 'verentis/nodejs',
    scripts: [createScript, postScript, apiScript],
    install,
    creatables,
    sandbox: { 'allow-scripts': true, 'allow-same-origin': true, 'allow-forms': true, 'allow-popups': false },
  },
  packaging: {
    publisher: 'verentis',
    files: ['canvas/**', 'schemas/**', 'templates/**', 'seed/**', 'scripts/**', 'desktop/**', 'README.md'],
    // Bound Canvas documents carry their registration entry; `verentis pack` substitutes the origin.
    templates: ['canvas/*.yaml'],
    variables: { 'canvas-origin': canvasOrigin },
    encryption: 'none',
  },
}

export const featureOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'invoicing' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'invoicing' },
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
  app: 'Invoicing',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath, accountingSettingsPath],
}

