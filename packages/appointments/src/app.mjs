import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'appointments-create'
export const postScript = 'scripts/post'
export const postScriptName = 'appointments-post'
/** Where `spec.install` places the appointment action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { type: 'appointment types', appointment: 'appointments' }

/**
 * What the create script may touch: it writes new records create-only, reads the defaults they start with and
 * reads the chosen type to schedule the end time (the types container is already a write grant).
 */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new appointments to the default type' },
]

/** What the appointment action script may touch: it moves appointments through their statuses. */
export const postScriptFileAccess = [
  { path: containers.appointments.path, mode: 'write', reason: 'Confirm, complete, cancel and mark appointments as no-show' },
  { path: containers.types.path, mode: 'read', reason: 'Read the appointment type\'s duration and buffer for the schedule and conflict check' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  type: {
    singular: 'Appointment type', plural: 'Appointment types', titleKey: 'name', icon: 'lucide:calendar-clock',
    folderNames: ['appointment-types', 'types', 'appointments'],
    sections: [
      { title: 'Type', fields: [
        text('name', 'Name', { required: true, placeholder: 'e.g. Intro call' }),
        text('host', 'Host', { placeholder: 'Name or email', description: 'Copied to new appointments of this type.' }),
        { key: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: 5, max: 1440, step: 5, required: true,
          description: 'New appointments end this long after their start time.' },
        { key: 'bufferMinutes', label: 'Buffer (minutes)', type: 'number', min: 0, max: 240, step: 5,
          description: 'Kept free around appointments in the confirm conflict check.' },
        text('location', 'Location or link', { placeholder: 'Room or meeting link' }),
        select('active', 'Active', [{ label: 'Yes', value: true }, { label: 'No', value: false }])] },
    ],
  },
  appointment: {
    singular: 'Appointment', plural: 'Appointments', titleKey: 'guestName', icon: 'lucide:calendar-check', status: 'status',
    folderNames: ['appointments', 'bookings'],
    sections: [
      { title: 'Guest', fields: [
        text('guestName', 'Guest name', { required: true }),
        { key: 'guestEmail', label: 'Guest email', type: 'email' },
        select('type', 'Type', '{{ data.typeoptions }}', { description: 'Sets the end time and host when confirming.' }),
        select('status', 'Status', labelled(statuses), { description: 'Changed by the Confirm, Complete, Cancel and No-show actions.', readOnly: 'true' })] },
      { title: 'Schedule', fields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('host', 'Host', { placeholder: 'Name or email', description: 'Filled from the type when left empty.' }),
        text('startTime', 'Start time', { placeholder: '09:00', description: 'Time of day, HH:MM.' }),
        text('endTime', 'End time', { placeholder: '09:30', description: 'Left empty, it is computed from the type\'s duration.' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', fields: [
    select('defaultType', 'Default type', '{{ data.typeoptions }}', { span: 2, description: 'New appointments start with this type.' })] },
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
  // Explicit MIME so placeholder templates are never classified as Appointments records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'appointments', name: 'Appointments',
    description: "Organise bookings around the time each appointment actually needs.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Appointments cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Appointments overview in Canvas", "caption": "Appointments overview"}, {"source": "./marketplace/detail.png", "alt": "Types in Canvas", "caption": "Types"}],
    readme: "./marketplace/README.md",
    keywords: ['appointments', 'booking', 'scheduling', 'calendar', 'meetings'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Appointments', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'upcoming', 'display-name': 'Upcoming', route: '/render?document=.%2Fcanvas%2Fupcoming.page.yaml', order: 20 },
      { id: 'types', 'display-name': 'Types', route: '/render?document=.%2Fcanvas%2Ftypes.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['appointments.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'appointments' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'appointments' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Appointments',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
