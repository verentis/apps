import {
  codeDigits, codeSettings, containerOf, containers, contractStatuses, contractTypes, createDefaults, installRoot,
  mimeTypes, recordKinds, recordPath, serviceTypes, settingsPath, starterRecords,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'fleet-create'
export const postScript = 'scripts/post'
export const postScriptName = 'fleet-post'
/** Where `spec.install` places the posting script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new records create-only into the Fleet containers. */
export const createScriptFileAccess = recordKinds.map(kind => ({
  path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${kind}s with the next code`,
}))

/** What the posting script may touch: it checks vehicles, retires them, and marks service logs done. */
export const postScriptFileAccess = [
  { path: containers.vehicles.path, mode: 'write', reason: 'Retire vehicles and update their odometer when a service is logged' },
  { path: containers.services.path, mode: 'write', reason: 'Mark service logs done' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const choices = values => values.map(value => ({ label: value[0].toUpperCase() + value.slice(1).split('-').join(' '), value }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  vehicle: {
    singular: 'Vehicle', plural: 'Vehicles', icon: 'lucide:car', status: 'status',
    title: "{{ ((form.values.make || '') + ' ' + (form.values.model || '')).trim() || 'New vehicle' }}",
    folderNames: ['vehicles', 'fleet'],
    sections: [
      { title: 'Vehicle', fields: [
        text('make', 'Make', { required: true }), text('model', 'Model', { required: true }),
        text('year', 'Year', { placeholder: '2024' }), text('licensePlate', 'License plate', { placeholder: 'CA 123-456' }),
        text('vin', 'VIN', { placeholder: 'JTDBR32E720045671' }),
      ] },
      { title: 'Operation', fields: [
        text('driverName', 'Driver'),
        select('status', 'Status', choices(['active', 'in-maintenance']),
          { description: 'Retiring a vehicle is done with the Retire action and cannot be undone from the form.' }),
        text('odometerKm', 'Odometer (km)', { placeholder: '0', description: 'Current odometer reading in kilometres, as an exact decimal.' }),
      ] },
    ],
  },
  contract: {
    singular: 'Contract', plural: 'Contracts', icon: 'lucide:file-signature', status: 'status',
    title: "{{ form.values.vendor || 'New contract' }}",
    folderNames: ['fleet-contracts', 'contracts', 'fleet'],
    sections: [
      { title: 'Contract', fields: [
        select('vehicle', 'Vehicle', '{{ data.vehicleoptions }}', { required: true }),
        select('type', 'Type', choices(contractTypes)),
        text('vendor', 'Vendor', { required: true }),
        text('monthlyCost', 'Monthly cost', { placeholder: '0.00' }),
      ] },
      { title: 'Term', fields: [
        { key: 'startDate', label: 'Start date', type: 'date', required: true },
        { key: 'endDate', label: 'End date', type: 'date', required: true },
        select('status', 'Status', choices(contractStatuses)),
      ] },
    ],
  },
  service: {
    singular: 'Service log', plural: 'Service logs', icon: 'lucide:wrench', status: 'status',
    title: "{{ form.values.description || 'New service log' }}",
    folderNames: ['service-logs', 'services', 'fleet'],
    sections: [{ title: 'Service', fields: [
      select('vehicle', 'Vehicle', '{{ data.vehicleoptions }}', { required: true }),
      { key: 'date', label: 'Date', type: 'date', required: true },
      select('type', 'Type', choices(serviceTypes)),
      text('odometerKm', 'Odometer reading (km)', { required: true, placeholder: '0', description: 'Must be at least the vehicle\u2019s current odometer.' }),
      text('cost', 'Cost', { placeholder: '0.00' }),
      { key: 'description', label: 'Description', type: 'textarea', span: 2 },
    ] }],
  },
}

export const settingsFields = [
  { key: 'expiringSoonDays', label: 'Expiring soon window (days)', type: 'number', min: 1, max: 365,
    description: 'Contracts ending within this many days are flagged on the Contracts page.' },
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
  ...starterRecords.map(record => ({ from: `seed/starter/${record.code}.json`, to: recordPath(record), mode: 'seed', mime: mimeTypes[record.kind] })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'fleet', name: 'Fleet',
    description: 'Vehicles, fleet contracts and service logs as files in your workspace, validated and posted by script and reported with Canvas.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['fleet', 'vehicles', 'contracts', 'lease', 'insurance', 'service logs', 'odometer', 'maintenance'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Fleet', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'contracts', 'display-name': 'Contracts', route: '/render?document=.%2Fcanvas%2Fcontracts.page.yaml', order: 20 },
      { id: 'costs', 'display-name': 'Costs', route: '/render?document=.%2Fcanvas%2Fcosts.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['fleet.default'],
    settings,
    dependencies: [{ package: 'verentis/canvas', version: 'latest' }, { package: 'verentis/nodejs', version: 'latest' }],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'fleet' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'fleet' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Fleet',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
