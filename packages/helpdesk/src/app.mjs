import { employeeLink } from '../../../tools/file-apps/canvas.mjs'
import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, priorities,
  recordKinds, settingsPath, stages, starterRecords,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'


/** Who works the ticket: an Employees record when Employees is installed (the picker fills the name), else a name. */
export const assignee = employeeLink('assigneeRef', 'assignee', { label: 'Assignee record' })

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'helpdesk-create'
export const postScript = 'scripts/post'
export const postScriptName = 'helpdesk-post'
/** Where `spec.install` places the ticket action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { team: 'teams', ticket: 'tickets' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new tickets to the default team' },
]

/** What the ticket action script may touch: it resolves and closes tickets conditionally, reading nothing else. */
export const postScriptFileAccess = [
  { path: containers.tickets.path, mode: 'write', reason: 'Mark tickets solved or closed' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  team: {
    singular: 'Team', plural: 'Teams', titleKey: 'name', icon: 'lucide:users',
    folderNames: ['helpdesk-teams', 'teams', 'helpdesk'],
    sections: [
      { title: 'Team', fields: [text('name', 'Name', { required: true }),
        { key: 'slaHours', label: 'SLA hours', type: 'number', min: 1, max: 8760, required: true,
          description: 'New tickets get a deadline this many hours after creation.' }] },
      { title: 'Members', fields: [{ key: 'members', label: 'Members', type: 'text-list', span: 2 }] },
    ],
  },
  ticket: {
    singular: 'Ticket', plural: 'Tickets', titleKey: 'subject', icon: 'lucide:ticket', status: 'stage',
    folderNames: ['tickets', 'helpdesk'],
    sections: [
      { title: 'Ticket', fields: [text('subject', 'Subject', { required: true, span: 2 }),
        { key: 'team', label: 'Team', type: 'select', options: '{{ data.teamoptions }}' },
        text('assignee', 'Assignee', { placeholder: 'Name or email' }),
        assignee.field,
        select('priority', 'Priority', labelled(priorities)),
        select('stage', 'Stage', labelled(stages), { description: 'Solved and closed are set by Resolve and Close.' }),
        text('slaDeadline', 'SLA deadline', { readOnly: 'true', description: 'Computed from the team\'s SLA hours at creation.' })] },
      { title: 'Customer', fields: [
        select('customerRef', 'CRM customer', '{{ data.customeroptions }}', { description: 'Optional. Choose a CRM customer, then Copy name.' }),
        text('customerName', 'Customer name')] },
      { title: 'Details', fields: [{ key: 'description', label: 'Description', type: 'textarea', span: 2, rows: 6 },
        { key: 'resolution', label: 'Resolution', type: 'textarea', span: 2, description: 'Required before a ticket can be resolved.' }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultTeam', label: 'Default team', type: 'select', options: '{{ data.teamoptions }}', span: 2,
    description: 'New tickets start with this team; its SLA hours set their deadline.' },
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
    id: kind, 'display-name': entity.singular, description: `A new helpdesk ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Helpdesk records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // A starter team and sample tickets, seeded once and kept on upgrade and uninstall.
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
    id: 'helpdesk', name: 'Helpdesk',
    description: "Give support teams a shared ticket queue and a clear view of deadlines.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Helpdesk cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Helpdesk overview in Canvas", "caption": "Helpdesk overview"}, {"source": "./marketplace/detail.png", "alt": "Tickets in Canvas", "caption": "Tickets"}],
    readme: "./marketplace/README.md",
    keywords: ['helpdesk', 'support', 'tickets', 'sla', 'teams', 'service desk', 'customer service'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Helpdesk', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'tickets', 'display-name': 'Tickets', route: '/render?document=.%2Fcanvas%2Ftickets.page.yaml', order: 20 },
      { id: 'sla', 'display-name': 'SLA report', route: '/render?document=.%2Fcanvas%2Fsla.page.yaml', order: 30 },
      { id: 'workload', 'display-name': 'Workload', route: '/render?document=.%2Fcanvas%2Fworkload.page.yaml', order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['helpdesk.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/crm', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'helpdesk' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'helpdesk' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Helpdesk',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
