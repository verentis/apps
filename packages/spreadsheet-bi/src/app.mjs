import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, sourceContainers, tileKinds,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'spreadsheet-bi-create'
export const postScript = 'scripts/post'
export const postScriptName = 'spreadsheet-bi-post'
/** Where `spec.install` places the snapshot script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { dashboard: 'dashboards', snapshot: 'snapshots' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new snapshots to the default dashboard' },
]

/** What the snapshot script may touch: it reads a dashboard and its source containers, then writes the results. */
export const postScriptFileAccess = [
  { path: containers.dashboards.path, mode: 'read', reason: 'Read the dashboard a snapshot computes' },
  { path: containers.snapshots.path, mode: 'write', reason: 'Write computed results into snapshots and mark them taken' },
  ...sourceContainers.map(path => ({ path, mode: 'read', reason: `Compute tile values over ${path} (when the owning app is installed)` })),
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

const tilesField = {
  key: 'tiles', label: 'Tiles', type: 'rows', maximum: 100, span: 2, addLabel: 'Add tile',
  defaultRow: { sequence: '', title: '', source: '', kind: 'count', valueField: '', groupByField: '', filter: { field: '', equals: '' } },
  fields: [
    { key: 'sequence', label: 'Seq', required: true },
    { key: 'title', label: 'Title', required: true },
    { key: 'source', label: 'Source container', required: true },
    { key: 'kind', label: 'Kind', type: 'select', required: true, options: labelled(tileKinds) },
    { key: 'valueField', label: 'Value field' },
    { key: 'groupByField', label: 'Group by' },
    { key: 'filter.field', label: 'Filter field' },
    { key: 'filter.equals', label: 'Filter equals' },
  ],
}

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  dashboard: {
    singular: 'Dashboard', plural: 'Dashboards', titleKey: 'name', icon: 'lucide:layout-dashboard',
    folderNames: ['bi-dashboards', 'dashboards', 'spreadsheet-bi'],
    sections: [
      { title: 'Dashboard', fields: [
        text('name', 'Name', { required: true }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
      { title: 'Tiles',
        description: 'Each tile aggregates one source container (an absolute path such as /invoices). Sum kinds need a value field (dot notation, e.g. totals.gross); group kinds need a group-by field. The optional filter keeps records whose field equals a value.',
        fields: [tilesField] },
    ],
  },
  snapshot: {
    singular: 'Snapshot', plural: 'Snapshots', titleKey: 'code', icon: 'lucide:camera', status: 'status',
    folderNames: ['bi-snapshots', 'snapshots', 'spreadsheet-bi'],
    sections: [
      { title: 'Snapshot', fields: [
        { key: 'dashboard', label: 'Dashboard', type: 'select', options: '{{ data.dashboardoptions }}', required: true, span: 2 },
        text('takenAt', 'Taken at', { readOnly: 'true', description: 'Stamped by Take snapshot.' })] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultDashboard', label: 'Default dashboard', type: 'select', options: '{{ data.dashboardoptions }}', span: 2,
    description: 'New snapshots start with this dashboard.' },
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
    id: kind, 'display-name': entity.singular, description: `A new BI ${entity.singular.toLowerCase()}`,
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
  // A sample dashboard, seeded once and kept on upgrade and uninstall.
  { from: 'seed/starter/BID-0001.json', to: `${containers.dashboards.path}/BID-0001`, mode: 'seed', mime: mimeTypes.dashboard },
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'spreadsheet-bi', name: 'Spreadsheet BI',
    description: 'Saved BI dashboards and snapshots as files in your workspace, computed live from the record files of CRM, Invoicing, Accounting and Helpdesk.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['bi', 'dashboards', 'pivot', 'reports', 'analytics', 'spreadsheet', 'snapshots'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Spreadsheet BI', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'viewer', 'display-name': 'Dashboard viewer', route: '/render?document=.%2Fcanvas%2Fviewer.page.yaml', order: 20 },
      { id: 'snapshots', 'display-name': 'Snapshots', route: '/render?document=.%2Fcanvas%2Fsnapshots.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['spreadsheet-bi.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
      { package: 'verentis/invoicing', version: 'latest', optional: true },
      { package: 'verentis/accounting', version: 'latest', optional: true },
      { package: 'verentis/helpdesk', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'spreadsheet-bi' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'spreadsheet-bi' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Spreadsheet BI',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
