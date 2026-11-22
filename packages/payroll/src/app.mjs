import {
  accounting, accountingSettingsPath, codeDigits, codeSettings, computations, containerOf, containers, createDefaults,
  employees, installRoot, mimeTypes, recordKinds, ruleKinds, seedRecords, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'payroll-create'
export const postScript = 'scripts/post'
export const postScriptName = 'payroll-post'
/** Where `spec.install` places the run script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { structure: 'salary structures', profile: 'pay profiles', payrun: 'pay runs' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number` })),
  { path: settingsPath, mode: 'read', reason: 'Read the Payroll defaults for new records' },
  { path: accountingSettingsPath, mode: 'read', reason: 'Default new records to the ledger\'s base currency' },
]

/** What the run script may touch: it computes payslips, validates against the ledger and posts pay run journals. */
export const postScriptFileAccess = [
  { path: settingsPath, mode: 'read', reason: 'Read the accounts pay runs post to' },
  { path: accountingSettingsPath, mode: 'read', reason: 'Read the ledger\'s base currency and precision' },
  { path: accounting.accounts, mode: 'read', reason: 'Check that posted accounts exist and are active' },
  { path: accounting.periods, mode: 'read', reason: 'Find the open period a pay run posts in' },
  { path: accounting.journals, mode: 'write', reason: 'Post one journal per pay run' },
  { path: containers.structures.path, mode: 'read', reason: 'Read the salary structures payslips are computed from' },
  { path: containers.profiles.path, mode: 'read', reason: 'Read the active pay profiles a run pays' },
  { path: containers.runs.path, mode: 'write', reason: 'Store computed payslips and mark runs computed, approved or posted' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const humanized = value => value[0].toUpperCase() + value.slice(1).split('-').join(' ')
const choices = values => values.map(value => ({ value, label: humanized(value) }))

const rulesRows = {
  key: 'rules', label: 'Rules', type: 'rows', minimum: 1, maximum: 100, span: 2, addLabel: 'Add rule',
  defaultRow: { code: '', name: '', kind: 'earning', computation: 'percent-of-base', amount: '', rate: '', sequence: '' },
  fields: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: choices(ruleKinds) },
    { key: 'computation', label: 'Computation', type: 'select', options: choices(computations) },
    { key: 'amount', label: 'Amount' },
    { key: 'rate', label: 'Rate %' },
    { key: 'sequence', label: 'Sequence', required: true },
  ],
}

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  structure: {
    singular: 'Salary structure', plural: 'Salary structures', titleKey: 'name', icon: 'lucide:layers', status: '',
    folderNames: ['salary-structures', 'payroll'],
    sections: [
      { title: 'Structure', fields: [text('name', 'Name', { required: true, span: 2 })] },
      { title: 'Rules',
        description: 'Region-agnostic: rules are your data, not built-in tax tables. Fixed rules use Amount; percent-of-base rules use Rate %. Rules apply in Sequence order.',
        fields: [rulesRows] },
    ],
  },
  profile: {
    singular: 'Pay profile', plural: 'Pay profiles', titleKey: 'employeeName', icon: 'lucide:id-card', status: '',
    folderNames: ['pay-profiles', 'payroll'],
    sections: [
      { title: 'Employee', fields: [
        text('employeeName', 'Employee name', { required: true }),
        select('employeeRef', 'Employee record', '{{ data.employeeoptions }}', { description: 'Optional. Link the Employees record (when Employees is installed).' })] },
      { title: 'Pay', fields: [
        select('structure', 'Salary structure', '{{ data.structureoptions }}', { required: true, span: 2 }),
        text('baseWage', 'Base monthly wage', { placeholder: '0.00', required: true }),
        text('currency', 'Currency', { placeholder: 'ZAR' })] },
    ],
  },
  payrun: {
    singular: 'Pay run', plural: 'Pay runs', titleKey: 'period', icon: 'lucide:calendar-check', status: 'status',
    folderNames: ['pay-runs', 'payroll'],
    sections: [
      { title: 'Pay run', fields: [
        text('period', 'Period (YYYY-MM)', { placeholder: '2026-11', required: true }),
        text('currency', 'Currency', { placeholder: 'ZAR' })] },
    ],
  },
}

const accountSelect = (key, label) => select(key, label, '{{ data.accountoptions }}', { required: false })
export const settingsSections = [
  { title: 'Posting accounts',
    description: 'Accounts in the Accounting chart of accounts that pay runs post to. The journal debits wage and contribution expenses and credits the payable accounts.',
    fields: [
      accountSelect('wageExpenseAccount', 'Wage expense'),
      accountSelect('deductionsPayableAccount', 'Deductions payable'),
      accountSelect('netWagesPayableAccount', 'Net wages payable'),
      accountSelect('contributionExpenseAccount', 'Employer contribution expense'),
      accountSelect('contributionPayableAccount', 'Employer contributions payable')] },
]

/** `spec.settings`: number prefixes and width the create script reads through the engine SDK. */
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
  // Sample records (a structure, two profiles and a draft run) are seeded once and kept on upgrade.
  ...seedRecords.map(({ from, to, mime }) => ({ from, to, mode: 'seed', mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'payroll', name: 'Payroll',
    description: 'A region-agnostic payroll engine: salary structures, pay profiles and pay runs as files in your workspace, computed and posted to the Accounting ledger by script.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['payroll', 'salaries', 'payslips', 'pay runs', 'wages', 'hr', 'accounting'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Payroll', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'structures', 'display-name': 'Structures', route: '/render?document=.%2Fcanvas%2Fstructures.page.yaml', order: 20 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['payroll.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/accounting', version: 'latest' },
      { package: 'verentis/employees', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'payroll' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'payroll' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Payroll',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath, accountingSettingsPath],
}

/** Employees is optional: pay profiles read its public file contract and degrade gracefully when absent. */
export { employees }
