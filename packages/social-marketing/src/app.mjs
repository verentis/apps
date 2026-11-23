import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, networkLabels,
  networks, recordKinds, settingsPath, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'social-marketing-create'
export const postScript = 'scripts/post'
export const postScriptName = 'social-marketing-post'
/** Where `spec.install` places the post action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { account: 'social accounts', post: 'posts' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new posts\' social account' },
]

/** What the post action script may touch: it schedules, publishes and cancels posts conditionally. */
export const postScriptFileAccess = [
  { path: containers.posts.path, mode: 'write', reason: 'Schedule, publish and cancel posts' },
  { path: containers.accounts.path, mode: 'read', reason: 'Check a post\'s social account is active at publish' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const number = (key, label, extra = {}) => ({ key, label, type: 'number', min: 0, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))
export const networkOptions = networks.map(value => ({ value, label: networkLabels[value] }))

/**
 * Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row.
 * A section's `lock` names when its fields become read-only: `closed` once a post is published or cancelled,
 * `engagement` until it is published (engagement stays editable after publishing).
 */
export const entities = {
  account: {
    singular: 'Social account', plural: 'Social accounts', titleKey: 'handle', icon: 'lucide:at-sign',
    folderNames: ['social-accounts', 'social-marketing'],
    sections: [
      { title: 'Social account', fields: [
        select('network', 'Network', networkOptions, { required: true }),
        text('handle', 'Handle', { required: true, placeholder: '@brand or page name' }),
        { key: 'active', label: 'Active', type: 'switch', span: 2,
          description: 'Only active accounts can publish posts.' }] },
    ],
  },
  post: {
    singular: 'Post', plural: 'Posts', titleKey: 'code', icon: 'lucide:megaphone', status: 'status',
    folderNames: ['social-posts', 'social-marketing'],
    sections: [
      { title: 'Post', lock: 'closed', fields: [
        { key: 'account', label: 'Social account', type: 'select', options: '{{ data.accountoptions }}' },
        { key: 'scheduledDate', label: 'Scheduled date', type: 'date', description: 'Required before Schedule.' },
        select('status', 'Status', labelled(statuses), { readOnly: 'true', description: 'Set by Schedule, Publish and Cancel.' })] },
      { title: 'Content', lock: 'closed', fields: [
        { key: 'content', label: 'Content', type: 'textarea', span: 2, rows: 8, description: 'Required before Publish.' },
        text('mediaNote', 'Media note', { span: 2, placeholder: 'e.g. attach the launch banner' })] },
      { title: 'Publication', fields: [
        text('publishedAt', 'Published at', { readOnly: 'true', description: 'Stamped by Publish. Delivery to the network is a platform integration.' })] },
      { title: 'Engagement', lock: 'engagement', description: 'Recorded by hand after publishing.', fields: [
        number('engagement.likes', 'Likes'),
        number('engagement.shares', 'Shares'),
        number('engagement.comments', 'Comments')] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultAccount', label: 'Default social account', type: 'select', options: '{{ data.accountoptions }}',
    description: 'New posts start with this social account.' },
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
    id: kind, 'display-name': entity.singular, description: `A new social marketing ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Social Marketing records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'social-marketing', name: 'Social Marketing',
    description: "Plan social content across accounts and compare engagement.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Social Marketing cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Social Marketing overview in Canvas", "caption": "Social Marketing overview"}, {"source": "./marketplace/detail.png", "alt": "Upcoming posts in Canvas", "caption": "Upcoming posts"}],
    readme: "./marketplace/README.md",
    keywords: ['social media', 'marketing', 'posts', 'publishing', 'engagement', 'scheduling'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Social Marketing', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'upcoming', 'display-name': 'Upcoming posts', route: '/render?document=.%2Fcanvas%2Fupcoming.page.yaml', order: 20 },
      { id: 'engagement', 'display-name': 'Engagement', route: '/render?document=.%2Fcanvas%2Fengagement.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['social-marketing.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'social-marketing' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'social-marketing' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Social Marketing',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
