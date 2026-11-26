import { employeeLink } from '../../../tools/file-apps/canvas.mjs'
import {
  accounting, accountingSettingsPath, codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot,
  mimeTypes, recordKinds, sampleReport, settingsPath, starterCategories,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'


/** The report's employee: an Employees record when Employees is installed (the picker fills the name), else a name. */
export const employee = employeeLink('employeeRecord', 'employeeName')

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'expenses-create'
export const postScript = 'scripts/post'
export const postScriptName = 'expenses-post'
/** Where `spec.install` places the posting script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { category: 'expense categories', report: 'expense reports' }

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = recordKinds.map(kind => ({
  path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number`,
}))

/** What the posting script may touch: it validates against the ledger, posts journals and moves reports through their statuses. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Read the reimbursement account reports post against' },
  { path: accountingSettingsPath, mode: 'read', reason: 'Read the ledger\'s base currency and precision' },
  { path: accounting.accounts, mode: 'read', reason: 'Check that posted accounts exist and are active' },
  { path: accounting.periods, mode: 'read', reason: 'Find the open period a posting date falls in' },
  { path: containers.categories.path, mode: 'read', reason: 'Read the expense account of each line\'s category' },
  { path: containers.reports.path, mode: 'write', reason: 'Mark reports submitted, approved, refused or posted' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  category: {
    singular: 'Expense category', plural: 'Expense categories', titleKey: 'name', icon: 'lucide:tags', status: 'status',
    folderNames: ['expense-categories', 'expenses'],
    sections: [
      { title: 'Category', description: 'Lines of this category post to its expense account in the Accounting chart of accounts.', fields: [
        text('name', 'Name', { required: true }),
        select('expenseAccount', 'Expense account', '{{ data.accountoptions }}', { required: true })] },
    ],
  },
  report: {
    singular: 'Expense report', plural: 'Expense reports', titleKey: 'employeeName', icon: 'lucide:receipt', status: 'status',
    folderNames: ['expense-reports', 'expenses'],
    sections: [
      { title: 'Employee', fields: [
        text('employeeName', 'Employee', { required: true }),
        employee.field,
        text('employeeRef', 'Employee reference', { placeholder: 'HR number' }),
        { key: 'date', label: 'Report date', type: 'date', required: true }] },
      { title: 'Receipts', description: 'A photo of each receipt. On a phone, Add photo opens the camera.', fields: [
        { key: 'receipts', label: 'Receipts', type: 'photos', max: 10 }] },
      { title: 'Expenses', description: 'Exact decimal amounts. Submitting checks every line has a category, a description and a positive amount.', fields: [
        { key: 'lines', label: 'Lines', type: 'rows', minimum: 1, maximum: 200, span: 2, addLabel: 'Add expense',
          defaultRow: { category: '', description: '', amount: '', date: '' },
          fields: [
            { key: 'category', label: 'Category', type: 'select', required: true, options: '{{ data.categoryoptions }}' },
            { key: 'description', label: 'Description', required: true },
            { key: 'amount', label: 'Amount', required: true },
            { key: 'date', label: 'Date' },
          ] }] },
    ],
  },
}

export const settingsSections = [
  { title: 'Posting', description: 'Posted reports credit the reimbursement account and debit each line\'s category expense account.', fields: [
    select('reimbursementAccount', 'Reimbursement account', '{{ data.accountoptions }}', { required: true })] },
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
  ...starterCategories.map(category => ({ from: `seed/starter/${category.code}.json`, to: `${containers.categories.path}/${category.code}`, mode: 'seed', mime: mimeTypes.category })),
  { from: `seed/sample/${sampleReport.code}.json`, to: `${containers.reports.path}/${sampleReport.code}`, mode: 'seed', mime: mimeTypes.report },
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'expenses', name: 'Expenses',
    description: "Take employee expenses from submission through approval and accounting.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Expenses cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Expenses overview in Canvas", "caption": "Expenses overview"}, {"source": "./marketplace/detail.png", "alt": "Expense reports in Canvas", "caption": "Expense reports"}],
    readme: "./marketplace/README.md",
    keywords: ['expenses', 'expense reports', 'reimbursements', 'approvals', 'accounting'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Expenses', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'reports', 'display-name': 'Expense reports', route: `/render?document=${encodeURIComponent('./canvas/reports.page.yaml')}`, order: 20 },
      { id: 'by-category', 'display-name': 'By category', route: `/render?document=${encodeURIComponent('./canvas/by-category.page.yaml')}`, order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['expenses.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/accounting', version: 'latest' },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'expenses' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'expenses' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Expenses',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
