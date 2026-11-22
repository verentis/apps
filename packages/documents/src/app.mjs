import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, starterRecords, statusLabels, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'documents-create'
export const postScript = 'scripts/post'
export const postScriptName = 'documents-post'
/** Where `spec.install` places the document workflow script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { workspace: 'workspaces', document: 'document cards', tag: 'tags' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new document cards to the default workspace' },
]

/** What the workflow script may touch: it moves document cards through the review workflow, reading nothing else. */
export const postScriptFileAccess = [
  { path: containers.cards.path, mode: 'write', reason: 'Send document cards to review, validate, archive or return them' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })

export const statusOptions = statuses.map(value => ({ value, label: statusLabels[value] }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  workspace: {
    singular: 'Workspace', plural: 'Workspaces', titleKey: 'name', icon: 'lucide:folder-kanban',
    folderNames: ['document-workspaces', 'workspaces', 'documents'],
    sections: [
      { title: 'Workspace', fields: [text('name', 'Name', { required: true }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2, rows: 3 }] },
      { title: 'Default tags', fields: [{ key: 'defaultTags', label: 'Default tags', type: 'text-list', span: 2,
        description: 'New document cards filed into this workspace start with these tags.' }] },
    ],
  },
  document: {
    singular: 'Document', plural: 'Documents', titleKey: 'title', icon: 'lucide:file-text', status: 'status',
    folderNames: ['document-cards', 'documents'],
    sections: [
      { title: 'Document', fields: [text('title', 'Title', { required: true, span: 2 }),
        text('filePath', 'File path', { span: 2, placeholder: '/shared/contracts/example.pdf',
          description: 'Workspace path of the file this card describes. The file itself stays where it is — the platform VFS stores and versions it.' }),
        { key: 'workspace', label: 'Workspace', type: 'select', options: '{{ data.workspaceoptions }}' },
        text('owner', 'Owner', { placeholder: 'Name or email' }),
        select('status', 'Status', statusOptions, { description: 'In review, validated and archived are set by Send to review, Validate and Archive.' }),
        text('validatedAt', 'Validated at', { readOnly: 'true', description: 'Stamped by Validate.' })] },
      { title: 'Tags', fields: [{ key: 'tags', label: 'Tags', type: 'text-list', span: 2,
        description: 'Defaults from the workspace; curate the set in /document-tags.' }] },
      { title: 'Review', fields: [{ key: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 4 },
        { key: 'reviewComment', label: 'Review comment', type: 'textarea', span: 2, rows: 3,
          description: 'Required before returning a document in review to the inbox.' }] },
    ],
  },
  tag: {
    singular: 'Tag', plural: 'Tags', titleKey: 'label', icon: 'lucide:tag',
    folderNames: ['document-tags', 'tags'],
    sections: [
      { title: 'Tag', fields: [text('label', 'Label', { required: true }),
        text('category', 'Category', { placeholder: 'department, document-type, …' })] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultWorkspace', label: 'Default workspace', type: 'select', options: '{{ data.workspaceoptions }}', span: 2,
    description: 'New document cards start in this workspace and take its default tags.' },
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
    id: kind, 'display-name': entity.singular, description: `A new Documents ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Documents records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // Two starter workspaces, the tag set and sample cards, seeded once and kept on upgrade and uninstall.
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
    id: 'documents', name: 'Documents',
    description: 'A tagging and review workflow over files already in your workspace: document cards reference VFS paths, grouped into workspaces with tags, moved through inbox, review, validated and archived by scripted actions.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['documents', 'dms', 'tags', 'workspaces', 'review', 'validation', 'filing'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Documents', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'inbox', 'display-name': 'Inbox', route: '/render?document=.%2Fcanvas%2Finbox.page.yaml', order: 20 },
      { id: 'workspaces', 'display-name': 'Workspaces', route: '/render?document=.%2Fcanvas%2Fworkspaces.page.yaml', order: 30 },
      { id: 'library', 'display-name': 'Library', route: '/render?document=.%2Fcanvas%2Flibrary.page.yaml', order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['documents.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'documents' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'documents' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Documents',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
