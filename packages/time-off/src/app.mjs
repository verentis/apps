import { employeeLink } from '../../../tools/file-apps/canvas.mjs'
import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, starterRecords,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'


/** The request's employee: an Employees record when Employees is installed (the picker fills the name), else a name. */
export const employee = employeeLink('employeeRef', 'employeeName')

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'time-off-create'
export const postScript = 'scripts/post'
export const postScriptName = 'time-off-post'
/** Where `spec.install` places the request action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { type: 'leave types', request: 'leave requests' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new requests to the default leave type' },
]

/** What the request action script may touch: it moves requests through their statuses conditionally. */
export const postScriptFileAccess = [
  { path: containers.types.path, mode: 'read', reason: 'Check whether the request\'s leave type requires approval' },
  { path: containers.requests.path, mode: 'write', reason: 'Mark requests submitted, approved or refused' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  type: {
    singular: 'Leave type', plural: 'Leave types', titleKey: 'name', icon: 'lucide:tags',
    folderNames: ['leave-types', 'time-off'],
    sections: [
      { title: 'Leave type', fields: [
        text('name', 'Name', { required: true }),
        text('daysPerYear', 'Days allocated per year', { required: true, placeholder: 'e.g. 15',
          description: 'An exact decimal number of days; the allocation report compares it with approved requests.' }),
        { key: 'requiresApproval', label: 'Requires approval', type: 'switch', span: 2,
          description: 'When off, submitted requests of this type are approved automatically.' }] },
    ],
  },
  request: {
    singular: 'Leave request', plural: 'Leave requests', titleKey: 'employeeName', icon: 'lucide:calendar-off', status: 'status',
    folderNames: ['leave-requests', 'time-off', 'leave'],
    sections: [
      { title: 'Employee', fields: [
        text('employeeName', 'Employee', { required: true }),
        employee.field] },
      { title: 'Leave', fields: [
        select('type', 'Leave type', '{{ data.typeoptions }}', { required: true }),
        text('days', 'Days', { readOnly: 'true', description: 'The weekday count of the date range, computed at submission.' }),
        { key: 'startDate', label: 'First day', type: 'date', required: true },
        { key: 'endDate', label: 'Last day', type: 'date', required: true },
        { key: 'reason', label: 'Reason', type: 'textarea', span: 2, rows: 3 }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultType', label: 'Default leave type', type: 'select', options: '{{ data.typeoptions }}', span: 2,
    description: 'New leave requests start with this type.' },
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
  // Explicit MIME so placeholder templates are never classified as Time Off records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // Starter leave types and a sample request, seeded once and kept on upgrade and uninstall.
  ...starterRecords.map(record => ({
    from: `seed/starter/${record.code}.json`, to: `${containers[containerOf[record.kind]].path}/${record.code}`,
    mode: 'seed', mime: mimeTypes[record.kind],
  })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'time-off', name: 'Time Off',
    description: "Keep leave requests, decisions and allocations in one place.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Time Off cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Time Off overview in Canvas", "caption": "Time Off overview"}, {"source": "./marketplace/detail.png", "alt": "Leave requests in Canvas", "caption": "Leave requests"}],
    readme: "./marketplace/README.md",
    keywords: ['time off', 'leave', 'vacation', 'pto', 'holidays', 'approvals', 'hr'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Time Off', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'requests', 'display-name': 'Requests', route: `/render?document=${encodeURIComponent('./canvas/requests.page.yaml')}`, order: 20 },
      { id: 'allocations', 'display-name': 'Allocations', route: `/render?document=${encodeURIComponent('./canvas/allocations.page.yaml')}`, order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['time-off.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'time-off' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'time-off' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Time Off',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
