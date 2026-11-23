import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, starterRecords, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'knowledge-create'
export const postScript = 'scripts/post'
export const postScriptName = 'knowledge-post'
/** Where `spec.install` places the article action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { space: 'spaces', article: 'articles' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new articles to the default space' },
]

/** What the article action script may touch: it publishes, archives and restores articles conditionally. */
export const postScriptFileAccess = [
  { path: containers.articles.path, mode: 'write', reason: 'Mark articles published, archived or back in draft' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  space: {
    singular: 'Space', plural: 'Spaces', titleKey: 'name', icon: 'lucide:library',
    folderNames: ['knowledge-spaces', 'spaces', 'knowledge'],
    sections: [
      { title: 'Space', fields: [text('name', 'Name', { required: true }),
        text('icon', 'Icon', { placeholder: 'book', description: 'A short icon note or emoji shown in listings.' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
    ],
  },
  article: {
    singular: 'Article', plural: 'Articles', titleKey: 'title', icon: 'lucide:file-text', status: 'status',
    folderNames: ['articles', 'knowledge'],
    sections: [
      { title: 'Article', fields: [text('title', 'Title', { required: true, span: 2 }),
        { key: 'space', label: 'Space', type: 'select', options: '{{ data.spaceoptions }}' },
        { key: 'parent', label: 'Parent article', type: 'select', options: '{{ data.parentoptions }}',
          description: 'Optional. Nest this article beneath another one.' },
        text('owner', 'Owner', { placeholder: 'Name or email' }),
        select('status', 'Status', labelled(statuses), { readOnly: 'true',
          description: 'Set by the Publish, Archive and Restore actions.' }),
        { key: 'tags', label: 'Tags', type: 'text-list', span: 2 }] },
      { title: 'Body', fields: [
        { key: 'body', label: 'Body (Markdown)', type: 'textarea', span: 2, rows: 16,
          description: 'Markdown (text/markdown): headings, lists, links, tables and code blocks. Required before publishing.' }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultSpace', label: 'Default space', type: 'select', options: '{{ data.spaceoptions }}', span: 2,
    description: 'New articles start in this space.' },
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
    id: kind, 'display-name': entity.singular, description: `A new knowledge ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Knowledge records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // A starter space and sample articles (one nested), seeded once and kept on upgrade and uninstall.
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
    id: 'knowledge', name: 'Knowledge',
    description: "Give your team a shared handbook that is easy to browse.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Knowledge cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Knowledge overview in Canvas", "caption": "Knowledge overview"}, {"source": "./marketplace/detail.png", "alt": "Spaces in Canvas", "caption": "Spaces"}],
    readme: "./marketplace/README.md",
    keywords: ['knowledge', 'wiki', 'articles', 'documentation', 'markdown', 'spaces', 'handbook'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Knowledge', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'spaces', 'display-name': 'Spaces', route: '/render?document=.%2Fcanvas%2Fspaces.page.yaml', order: 20 },
      { id: 'recent', 'display-name': 'Recently updated', route: '/render?document=.%2Fcanvas%2Frecent.page.yaml', order: 30 },
      { id: 'tags', 'display-name': 'Tags', route: '/render?document=.%2Fcanvas%2Ftags.page.yaml', order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['knowledge.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'knowledge' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'knowledge' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Knowledge',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
