import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, equipmentStatuses, installRoot, mimeTypes,
  priorities, recordKinds, requestStages, requestTypes,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'maintenance-create'
export const postScript = 'scripts/post'
export const postScriptName = 'maintenance-post'
/** Where `spec.install` places the maintenance action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { equipment: 'equipment records', request: 'maintenance requests' }

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = recordKinds.map(kind => ({
  path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code`,
}))

/**
 * What the maintenance action script may touch: it moves requests through their stages and keeps the equipment
 * status in sync (under maintenance while a request runs, operational when repaired, scrapped when scrapped).
 */
export const postScriptFileAccess = [
  { path: containers.requests.path, mode: 'write', reason: 'Start, complete and scrap maintenance requests' },
  { path: containers.equipments.path, mode: 'write', reason: 'Keep the equipment status in sync with its maintenance requests' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  equipment: {
    singular: 'Equipment', plural: 'Equipment', titleKey: 'name', icon: 'lucide:wrench', status: 'status',
    folderNames: ['equipment', 'maintenance'],
    sections: [
      { title: 'Equipment', fields: [
        text('name', 'Name', { required: true, span: 2 }),
        text('category', 'Category', { placeholder: 'e.g. Machinery' }),
        text('serial', 'Serial number'),
        text('location', 'Location'),
        text('assignedTo', 'Assigned to', { placeholder: 'Name or email' }),
        select('status', 'Status', labelled(equipmentStatuses), { readOnly: 'true', description: 'Kept in sync by the maintenance request actions.' })] },
      { title: 'Lifecycle', fields: [
        { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
        { key: 'warrantyEnd', label: 'Warranty end', type: 'date' }] },
    ],
  },
  request: {
    singular: 'Maintenance request', plural: 'Maintenance requests', titleKey: 'code', icon: 'lucide:hammer', status: 'stage',
    folderNames: ['maintenance-requests', 'maintenance'],
    sections: [
      { title: 'Request', fields: [
        select('equipment', 'Equipment', '{{ data.equipmentoptions }}', { required: true, span: 2, description: 'Starting a request puts this equipment under maintenance.' }),
        select('type', 'Type', labelled(requestTypes)),
        select('priority', 'Priority', labelled(priorities)),
        select('stage', 'Stage', labelled(requestStages), { readOnly: 'true', description: 'Set by the Start, Complete and Scrap actions.' }),
        { key: 'scheduledDate', label: 'Scheduled date', type: 'date' },
        text('durationHours', 'Duration (hours)', { placeholder: '1.5' })] },
      { title: 'Details', fields: [{ key: 'description', label: 'Description', type: 'textarea', span: 2, rows: 6 }] },
    ],
  },
}

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
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'maintenance', name: 'Maintenance',
    description: "Keep equipment history and upcoming maintenance work in one place.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Maintenance cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Maintenance overview in Canvas", "caption": "Maintenance overview"}, {"source": "./marketplace/detail.png", "alt": "Equipment in Canvas", "caption": "Equipment"}],
    readme: "./marketplace/README.md",
    keywords: ['maintenance', 'equipment', 'preventive maintenance', 'corrective maintenance', 'repairs', 'cmms'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Maintenance', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'requests', 'display-name': 'Maintenance requests', route: `/render?document=${encodeURIComponent('./canvas/requests.page.yaml')}`, order: 20 },
      { id: 'equipment', 'display-name': 'Equipment', route: `/render?document=${encodeURIComponent('./canvas/equipment.page.yaml')}`, order: 30 },
      { id: 'preventive', 'display-name': 'Preventive plan', route: `/render?document=${encodeURIComponent('./canvas/preventive.page.yaml')}`, order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['maintenance.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'maintenance' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'maintenance' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Maintenance',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
