import { codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds, settingsPath, starterAccounts } from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.2.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'accounting-create'
export const postScript = 'scripts/post'
export const postScriptName = 'accounting-post'
/** The API script: the ledger operations other apps call through the platform (api.yaml). */
export const apiScript = 'scripts/api'
export const apiScriptName = 'accounting-api'
/** Where `spec.install` places the posting script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`
/** The Canvas page behind the "Balances" dashboard widget. */
export const balancesWidgetFile = 'balances.widget.page.yaml'

/** What the create script may touch: it writes new records create-only and reads the base currency. */
/** What the API script may touch: it checks and posts other apps' journals, and reverses the ones they posted. */
export const apiScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Check the base currency and precision of journals other apps post' },
  { path: containers.accounts.path, mode: 'read', reason: 'Check that posted accounts exist and are active' },
  { path: containers.periods.path, mode: 'read', reason: 'Find the open period a posting date falls in' },
  { path: containers.journals.path, mode: 'write', reason: 'Post and reverse journals other apps ask for' },
]

export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({
    path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${kind === 'account' ? 'accounts' : `${kind}s`} with the next code`,
  })),
  { path: settingsPath, mode: 'read', reason: 'Default new journals and expenses to the base currency' },
]

/** What the posting script may touch: it validates against accounts and periods, and posts journals and expenses. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Read the base currency, precision and tax codes' },
  { path: containers.accounts.path, mode: 'read', reason: 'Check that posted accounts exist and are active' },
  { path: containers.periods.path, mode: 'read', reason: 'Find the open period a posting date falls in' },
  { path: containers.journals.path, mode: 'write', reason: 'Post journals, write expense journals and reversals' },
  { path: containers.expenses.path, mode: 'write', reason: 'Mark expenses posted or reversed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
const amount = (key, label, extra = {}) => text(key, label, { placeholder: '0.00', ...extra })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  account: {
    singular: 'Account', plural: 'Chart of accounts', titleKey: 'name', icon: 'lucide:book-open', status: 'accountType',
    folderNames: ['chart-of-accounts', 'accounts', 'ledger', 'accounting'],
    sections: [{ title: 'Account', fields: [text('number', 'Account number', { placeholder: '1000' }), text('name', 'Name', { required: true }),
      select('accountType', 'Type', labelled(['asset', 'liability', 'equity', 'income', 'expense'])),
      { key: 'description', label: 'Description', type: 'textarea', span: 2 }] }],
  },
  period: {
    singular: 'Period', plural: 'Accounting periods', titleKey: 'name', icon: 'lucide:calendar-range', status: 'status',
    folderNames: ['periods', 'accounting'],
    sections: [{ title: 'Period', fields: [text('name', 'Name', { required: true, span: 2, placeholder: 'FY2026 March' }),
      { key: 'startDate', label: 'Start', type: 'date', required: true }, { key: 'endDate', label: 'End', type: 'date', required: true }] }],
  },
  journal: {
    singular: 'Journal', plural: 'Journals', titleKey: 'description', icon: 'lucide:notebook-pen', status: 'status',
    folderNames: ['journals', 'ledger', 'accounting'],
    sections: [
      { title: 'Journal', fields: [text('description', 'Description', { required: true, span: 2 }),
        { key: 'date', label: 'Date', type: 'date', required: true }, text('currency', 'Currency', { placeholder: 'ZAR', required: true })] },
      { title: 'Lines', description: 'Debits must equal credits. Amounts are exact decimals, e.g. 1250.00.', span: 2, fields: [
        { key: 'lines', label: 'Journal lines', type: 'rows', minimum: 2, maximum: 1000, span: 2, addLabel: 'Add line',
          // A live check while typing; the posting script is what enforces that a journal balances.
          summary: [
            { label: 'Debits', expr: "rows.filter(row => row.direction === 'debit').reduce((total, row) => total + Math.round(Number(row.amount || 0) * 100), 0) / 100", format: 'number' },
            { label: 'Credits', expr: "rows.filter(row => row.direction === 'credit').reduce((total, row) => total + Math.round(Number(row.amount || 0) * 100), 0) / 100", format: 'number' },
          ],
          assert: {
            expr: "rows.filter(row => row.direction === 'debit').reduce((total, row) => total + Math.round(Number(row.amount || 0) * 100), 0) === rows.filter(row => row.direction === 'credit').reduce((total, row) => total + Math.round(Number(row.amount || 0) * 100), 0)",
            ok: 'Debits equal credits', error: 'Debits and credits differ',
          },
          defaultRow: { account: '', direction: 'debit', amount: '' },
          fields: [
            { key: 'account', label: 'Account', type: 'select', required: true, options: '{{ data.accountoptions }}' },
            { key: 'direction', label: 'Direction', type: 'select', required: true, options: [{ label: 'Debit', value: 'debit' }, { label: 'Credit', value: 'credit' }] },
            { key: 'amount', label: 'Amount', required: true },
            { key: 'description', label: 'Description' },
          ] }] },
    ],
  },
  expense: {
    singular: 'Expense', plural: 'Expenses', titleKey: 'description', icon: 'lucide:receipt', status: 'status',
    folderNames: ['expenses', 'accounting'],
    sections: [
      { title: 'Expense', fields: [text('description', 'Description', { required: true, span: 2 }), text('payee', 'Payee'),
        { key: 'date', label: 'Date', type: 'date', required: true }] },
      { title: 'Amounts', fields: [text('currency', 'Currency', { placeholder: 'ZAR', required: true }), amount('netAmount', 'Net amount', { required: true }),
        amount('taxAmount', 'Tax amount'), select('taxCode', 'Tax code', '{{ data.taxcodeoptions }}')] },
      { title: 'Accounts', fields: [
        select('expenseAccount', 'Expense account', '{{ data.expenseaccountoptions }}', { required: true }),
        select('paymentAccount', 'Paid from', '{{ data.paymentaccountoptions }}', { required: true })] },
    ],
  },
}

export const settingsFields = [
  text('country', 'Country code', { placeholder: 'ZA' }), text('baseCurrency', 'Base currency', { placeholder: 'ZAR', required: true }),
  { key: 'minorDigits', label: 'Currency decimal places', type: 'number', min: 0, max: 4, required: true },
  { key: 'fiscalYearStartMonth', label: 'Fiscal year start month', type: 'number', min: 1, max: 12, required: true },
  { key: 'taxCodes', label: 'Tax codes', type: 'rows', maximum: 100, span: 2, addLabel: 'Add tax code',
    fields: [{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true },
      { key: 'ratePercent', label: 'Rate (%)', required: true },
      { key: 'account', label: 'Tax account', type: 'select', required: true, options: '{{ data.accountoptions }}' }],
    defaultRow: { code: '', name: '', ratePercent: '0', account: '' } },
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
  ...starterAccounts.map(account => ({ from: `seed/chart/${account.code}.json`, to: `${containers.accounts.path}/${account.code}`, mode: 'seed', mime: mimeTypes.account })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

/** `spec.widgets`: tiles the workspace dashboard offers, rendered by Canvas with `context.surface === 'widget'`. */
export const widgets = [
  {
    id: 'balances', 'display-name': 'Balances', description: 'Asset, liability and equity balances from posted journals',
    route: `/render?document=${encodeURIComponent(`./canvas/${balancesWidgetFile}`)}`,
    'default-size': { w: 4, h: 4 }, 'min-size': { w: 3, h: 3 },
  },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'accounting', name: 'Accounting',
    description: "Keep a double-entry ledger and see where your business stands.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Accounting cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Accounting overview in Canvas", "caption": "Accounting overview"}, {"source": "./marketplace/detail.png", "alt": "Financial reports in Canvas", "caption": "Financial reports"}],
    readme: "./marketplace/README.md",
    keywords: ['accounting', 'ledger', 'double-entry', 'journals', 'chart of accounts', 'expenses', 'trial balance', 'profit and loss', 'balance sheet'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Accounting', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'reports', 'display-name': 'Financial reports', route: '/render?document=.%2Fcanvas%2Freports.page.yaml', order: 20 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    widgets,
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['accounting.default'],
    settings,
    dependencies: [{ package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' }],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'accounting' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'accounting' },
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
  app: 'Accounting',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
