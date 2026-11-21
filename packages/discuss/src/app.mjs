import {
  channelKinds, channelStatuses, codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot,
  mimeTypes, recordKinds, settingsPath, threadStatuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'discuss-create'
export const postScript = 'scripts/post'
export const postScriptName = 'discuss-post'
/** Where `spec.install` places the discussion action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { channel: 'channels', thread: 'threads' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new threads to the default channel' },
]

/** What the discussion action script may touch: it appends messages and flips statuses conditionally. */
export const postScriptFileAccess = [
  { path: containers.threads.path, mode: 'write', reason: 'Post messages and resolve, lock or reopen threads' },
  { path: containers.channels.path, mode: 'write', reason: 'Archive channels and refuse posts into archived ones' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  channel: {
    singular: 'Channel', plural: 'Channels', titleKey: 'name', icon: 'lucide:hash', status: 'status',
    folderNames: ['channels', 'discuss'],
    sections: [
      { title: 'Channel', fields: [text('name', 'Name', { required: true }),
        select('visibility', 'Kind', labelled(channelKinds), { description: 'Private channels are for their members only.' }),
        text('topic', 'Topic', { span: 2 }),
        select('status', 'Status', labelled(channelStatuses), { description: 'Archived is set by the Archive channel action.' }),
        text('createdBy', 'Created by', { placeholder: 'Name or email' })] },
      { title: 'Members', fields: [{ key: 'members', label: 'Members', type: 'text-list', span: 2,
        description: 'Who takes part in this channel. Membership is a record, not an access control.' }] },
    ],
  },
  thread: {
    singular: 'Thread', plural: 'Threads', titleKey: 'subject', icon: 'lucide:messages-square', status: 'status',
    folderNames: ['threads', 'discuss'],
    sections: [
      { title: 'Thread', fields: [text('subject', 'Subject', { required: true, span: 2 }),
        { key: 'channel', label: 'Channel', type: 'select', options: '{{ data.channeloptions }}' },
        text('startedBy', 'Started by', { placeholder: 'Name or email' }),
        select('status', 'Status', labelled(threadStatuses), { description: 'Resolved and locked are set by the Resolve and Lock actions.' }),
        text('lastActivityAt', 'Last activity', { readOnly: 'true', description: 'Stamped when a message is posted.' })] },
      { title: 'Compose', fields: [text('postAs', 'Post as', { placeholder: 'Name or email' }),
        { key: 'draft', label: 'Message (Markdown)', type: 'textarea', span: 2, rows: 5,
          description: 'Save the thread, then Post message appends this to the trail and clears it.' }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultChannel', label: 'Default channel', type: 'select', options: '{{ data.channeloptions }}', span: 2,
    description: 'New threads start in this channel.' },
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
    id: kind, 'display-name': entity.singular, description: `A new discussion ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Discuss records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // A general channel and a welcome thread, seeded once and kept on upgrade and uninstall.
  { from: 'seed/starter/CH-0001.json', to: `${containers.channels.path}/CH-0001`, mode: 'seed', mime: mimeTypes.channel },
  { from: 'seed/starter/TH-0001.json', to: `${containers.threads.path}/TH-0001`, mode: 'seed', mime: mimeTypes.thread },
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'discuss', name: 'Discuss',
    description: 'Team discussion channels and threaded messages as files in your workspace: a durable, auditable record with scripted post, resolve, lock and archive actions. Realtime delivery is the platform\'s concern.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['discuss', 'discussion', 'channels', 'threads', 'messages', 'team communication', 'collaboration'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Discuss', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'channels', 'display-name': 'Channels', route: '/render?document=.%2Fcanvas%2Fchannels.page.yaml', order: 20 },
      { id: 'threads', 'display-name': 'Threads', route: '/render?document=.%2Fcanvas%2Fthreads.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['discuss.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'discuss' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'discuss' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Discuss',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
