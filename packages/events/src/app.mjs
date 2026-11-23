import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, eventStatuses, installRoot, mimeTypes,
  recordKinds, registrationStatuses, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'events-create'
export const postScript = 'scripts/post'
export const postScriptName = 'events-post'
/** Where `spec.install` places the action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { event: 'events', registration: 'registrations' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new events to the default venue' },
]

/** What the action script may touch: it enforces the event and registration transitions conditionally. */
export const postScriptFileAccess = [
  { path: containers.events.path, mode: 'write', reason: 'Publish, complete and cancel events, and read capacity when confirming' },
  { path: containers.registrations.path, mode: 'write', reason: 'Confirm, check in and cancel registrations, and sum confirmed quantities' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  event: {
    singular: 'Event', plural: 'Events', titleKey: 'name', icon: 'lucide:calendar', status: 'status',
    folderNames: ['events'],
    sections: [
      { title: 'Event', fields: [text('name', 'Name', { required: true, span: 2 }),
        select('status', 'Status', labelled(eventStatuses), { description: 'Published, done and cancelled are set by Publish, Complete and Cancel.' }),
        { key: 'capacity', label: 'Capacity', type: 'number', min: 0, max: 100000, required: true,
          description: 'Confirmed and attended seats never exceed this.' },
        text('startsAt', 'Starts at (UTC)', { placeholder: '2026-06-01T09:00:00Z' }),
        text('endsAt', 'Ends at (UTC)', { placeholder: '2026-06-01T17:00:00Z' }),
        text('ticketPrice', 'Ticket price', { placeholder: '0.00' })] },
      { title: 'Location', fields: [text('venue', 'Venue'),
        text('onlineLink', 'Online link', { placeholder: 'https://…' })] },
      { title: 'Details', fields: [{ key: 'description', label: 'Description', type: 'textarea', span: 2, rows: 6 }] },
    ],
  },
  registration: {
    singular: 'Registration', plural: 'Registrations', titleKey: 'attendeeName', icon: 'lucide:user-check', status: 'status',
    folderNames: ['event-registrations', 'registrations', 'events'],
    sections: [
      { title: 'Registration', fields: [
        select('event', 'Event', '{{ data.eventoptions }}', { span: 2, description: 'The event this registration belongs to.' }),
        text('attendeeName', 'Attendee name', { required: true }),
        text('attendeeEmail', 'Attendee email', { type: 'email' }),
        { key: 'qty', label: 'Seats', type: 'number', min: 1, max: 1000, required: true },
        select('status', 'Status', labelled(registrationStatuses), { description: 'Confirmed, attended and cancelled are set by Confirm, Check in and Cancel.' }),
        text('confirmedAt', 'Confirmed at', { readOnly: 'true', description: 'Stamped by Confirm.' })] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultVenue', label: 'Default venue', type: 'text', span: 2,
    description: 'New events start with this venue.' },
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
    id: kind, 'display-name': entity.singular, description: `A new event ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Events records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'events', name: 'Events',
    description: "Plan events and keep track of who is coming.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Events cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Events overview in Canvas", "caption": "Events overview"}, {"source": "./marketplace/detail.png", "alt": "All events in Canvas", "caption": "All events"}],
    readme: "./marketplace/README.md",
    keywords: ['events', 'registrations', 'attendees', 'tickets', 'capacity', 'venue'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Events', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'events', 'display-name': 'All events', route: '/render?document=.%2Fcanvas%2Fevents.page.yaml', order: 20 },
      { id: 'registrations', 'display-name': 'Registrations', route: '/render?document=.%2Fcanvas%2Fregistrations.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['events.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'events' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'events' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Events',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
