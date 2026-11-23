import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, invoicing, mimeTypes,
  recordKinds, settingsPath, stages, taskTypes,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'field-service-create'
export const postScript = 'scripts/post'
export const postScriptName = 'field-service-post'
/** Where `spec.install` places the task action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new tasks create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  { path: containers.tasks.path, mode: 'write', reason: 'Create field tasks with the next number' },
  { path: settingsPath, mode: 'read', reason: 'Default new tasks\' technician' },
]

/** What the task action script may touch: it moves tasks through their stages and may draft an invoice. */
export const postScriptFileAccess = [
  { path: containers.tasks.path, mode: 'write', reason: 'Schedule, start, complete and cancel field tasks' },
  { path: invoicing.invoices, mode: 'write', reason: 'Draft an invoice for a completed task (when Invoicing is installed)' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  task: {
    singular: 'Field task', plural: 'Field tasks', titleKey: 'customerName', icon: 'lucide:wrench', status: 'stage',
    folderNames: ['field-tasks', 'field-service'],
    sections: [
      { title: 'Customer', fields: [
        select('customerRef', 'CRM customer', '{{ data.customeroptions }}', { description: 'Optional. Choose a CRM customer, then Copy name.' }),
        text('customerName', 'Customer name', { required: true }),
        text('address', 'Address', { span: 2, required: true, placeholder: 'Street, city' })] },
      { title: 'Schedule', fields: [
        { key: 'scheduledDate', label: 'Scheduled date', type: 'date' },
        text('technician', 'Technician', { placeholder: 'Name or email' }),
        text('windowStart', 'Window start', { placeholder: '08:00', description: 'Time of day, HH:MM.' }),
        text('windowEnd', 'Window end', { placeholder: '10:00', description: 'Time of day, HH:MM.' })] },
      { title: 'Work', fields: [
        select('type', 'Type', labelled(taskTypes)),
        select('stage', 'Stage', labelled(stages), { description: 'Stages are set by Schedule, Start, Complete and Cancel.', readOnly: 'true' }),
        text('hours', 'Hours spent', { placeholder: '2.5', description: 'A decimal number of hours, required to complete.' }),
        text('materialsTotal', 'Materials total', { readOnly: 'true', description: 'Computed from the materials when the task is completed.' }),
        { key: 'workLog', label: 'Work log', type: 'textarea', span: 2, rows: 6 }] },
      { title: 'Materials', fields: [
        { key: 'materials', label: 'Materials used', type: 'rows', span: 2, addLabel: 'Add material', maximum: 200,
          defaultRow: { description: '', quantity: '1', unitPrice: '' },
          fields: [
            { key: 'description', label: 'Description' },
            { key: 'quantity', label: 'Qty' },
            { key: 'unitPrice', label: 'Unit price' },
          ] }] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', fields: [
    text('defaultTechnician', 'Default technician', { description: 'New tasks start with this technician.' })] },
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
  // Explicit MIME so placeholder templates are never classified as Field Service records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'field-service', name: 'Field Service',
    description: "Coordinate on-site work from the technician's schedule to the invoice draft.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Field Service cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Field Service overview in Canvas", "caption": "Field Service overview"}, {"source": "./marketplace/detail.png", "alt": "Tasks in Canvas", "caption": "Tasks"}],
    readme: "./marketplace/README.md",
    keywords: ['field service', 'tasks', 'technicians', 'onsite', 'install', 'repair', 'inspection', 'work orders'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Field Service', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'tasks', 'display-name': 'Tasks', route: '/render?document=.%2Fcanvas%2Ftasks.page.yaml', order: 20 },
      { id: 'schedule', 'display-name': 'Day schedule', route: '/render?document=.%2Fcanvas%2Fschedule.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['field-service.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'field-service' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'field-service' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Field Service',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
