import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  sampleRequest, settingsPath, starterTypes,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'approvals-create'
export const postScript = 'scripts/post'
export const postScriptName = 'approvals-post'
/** Where `spec.install` places the decision script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { type: 'approval types', request: 'approval requests' }

/** What the create script may touch: it writes new records create-only and reads the default requester. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({
    path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next number`,
  })),
  { path: settingsPath, mode: 'read', reason: 'Default new requests\' requester' },
]

/** What the decision script may touch: it checks the type\'s rules and moves requests through their statuses. */
export const postScriptFileAccess = [
  { path: containers.types.path, mode: 'read', reason: 'Read each request\'s type: its required fields and approver count' },
  { path: containers.requests.path, mode: 'write', reason: 'Mark requests submitted, approved, refused or cancelled' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const toggle = (key, label, description) => ({ key, label, type: 'switch', description })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  type: {
    singular: 'Approval type', plural: 'Approval types', titleKey: 'name', icon: 'lucide:list-checks', status: 'status',
    folderNames: ['approval-types', 'approvals'],
    sections: [
      { title: 'Approval type', description: 'What this kind of request is for and how many distinct approvers it needs.', fields: [
        text('name', 'Name', { required: true }),
        { key: 'requiredApprovers', label: 'Required approvals', type: 'number', min: 1, max: 20, required: true },
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
      { title: 'Required fields', description: 'Submitting a request of this type checks these fields are filled in.', fields: [
        toggle('requiresAmount', 'Requires an amount', 'Requests must state the amount involved.'),
        toggle('requiresDate', 'Requires a date', 'Requests must state the date they are for.'),
        toggle('requiresReference', 'Requires a reference', 'Requests must carry a reference (an order, a contract…).')] },
    ],
  },
  request: {
    singular: 'Approval request', plural: 'Approval requests', titleKey: 'title', icon: 'lucide:file-check', status: 'status',
    folderNames: ['approval-requests', 'approvals'],
    sections: [
      { title: 'Request', fields: [
        { key: 'type', label: 'Approval type', type: 'select', required: true, options: '{{ data.typeoptions }}' },
        text('requester', 'Requester', { required: true }),
        text('title', 'Title', { required: true, span: 2 }),
        { key: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2 }] },
      { title: 'Details', description: 'The approval type decides which of these submitting checks. Amounts are exact decimal strings.', fields: [
        text('amount', 'Amount', { placeholder: '1250.00' }),
        { key: 'date', label: 'Date', type: 'date' },
        text('reference', 'Reference', { placeholder: 'Order, contract or document reference' })] },
    ],
  },
}

export const settingsSections = [
  { title: 'Requests', description: 'New requests are prefilled with the default requester; number prefixes are app settings, managed with the installed app.', fields: [
    text('defaultRequester', 'Default requester', { placeholder: 'Who usually raises requests here?' })] },
]

/** `spec.settings`: number prefixes and width the create script reads through the engine SDK. */
export const settings = [
  ...Object.entries(codeSettings).map(([kind, setting]) => ({
    key: setting.key, 'display-name': setting.label, type: 'string', default: setting.default,
    description: `Prefix of generated ${entities[kind].singular.toLowerCase()} numbers, e.g. ${setting.default}${'0'.repeat(codeDigits.default - 1)}1.`,
  })),
  { key: codeDigits.key, 'display-name': codeDigits.label, type: 'number', default: codeDigits.default,
    description: 'Minimum number of digits in generated numbers (zero-padded).' },
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
  ...starterTypes.map(type => ({ from: `seed/starter/${type.code}.json`, to: `${containers.types.path}/${type.code}`, mode: 'seed', mime: mimeTypes.type })),
  { from: `seed/sample/${sampleRequest.code}.json`, to: `${containers.requests.path}/${sampleRequest.code}`, mode: 'seed', mime: mimeTypes.request },
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'approvals', name: 'Approvals',
    description: "Give your team one place to request a decision and see its outcome.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Approvals cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Approvals overview in Canvas", "caption": "Approvals overview"}, {"source": "./marketplace/detail.png", "alt": "Approval requests in Canvas", "caption": "Approval requests"}],
    readme: "./marketplace/README.md",
    keywords: ['approvals', 'approval requests', 'sign-off', 'workflow', 'decisions'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Approvals', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'requests', 'display-name': 'Requests', route: `/render?document=${encodeURIComponent('./canvas/requests.page.yaml')}`, order: 20 },
      { id: 'pending', 'display-name': 'To decide', route: `/render?document=${encodeURIComponent('./canvas/pending.page.yaml')}`, order: 30 },
      { id: 'by-type', 'display-name': 'By type', route: `/render?document=${encodeURIComponent('./canvas/by-type.page.yaml')}`, order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['approvals.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'approvals' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'approvals' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Approvals',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
