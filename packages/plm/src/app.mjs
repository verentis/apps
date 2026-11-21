import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'plm-create'
export const postScript = 'scripts/post'
export const postScriptName = 'plm-post'
/** Where `spec.install` places the review script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = [
  { path: containers.ecos.path, mode: 'write', reason: 'Create engineering change orders with the next code' },
]

/** What the review script may touch: it moves engineering change orders through their stages conditionally. */
export const postScriptFileAccess = [
  { path: containers.ecos.path, mode: 'write', reason: 'Submit, approve, reject and apply engineering change orders' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const choice = value => ({ label: value.split('-').join(' ').replace(/^./, first => first.toUpperCase()), value })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  eco: {
    singular: 'Engineering change order', plural: 'Engineering change orders', titleKey: 'title',
    icon: 'lucide:file-cog', status: 'stage',
    folderNames: ['engineering-change-orders', 'ecos', 'plm'],
    sections: [
      { title: 'Change', fields: [
        text('title', 'Title', { required: true, span: 2 }),
        select('type', 'Type', ['new-product', 'change', 'obsolete'].map(choice), { required: true }),
        select('priority', 'Priority', ['low', 'normal', 'high', 'urgent'].map(choice), { required: true }),
        select('product', 'Product / BoM', '{{ data.bomoptions }}',
          { span: 2, description: 'The bill of materials (or product) this change affects, from Manufacturing when it is installed.' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
      { title: 'Review', description: 'Fill in the approver during review; applying stamps the effective date.', fields: [
        text('approver', 'Approver', { placeholder: 'Who signs this change off' }),
        { key: 'effectiveDate', label: 'Effective date', type: 'date' },
        { key: 'rejectionReason', label: 'Rejection reason', type: 'textarea', span: 2,
          description: 'Required to reject.', visible: "form.values.stage === 'in-review' || form.values.stage === 'rejected'" }] },
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
    id: 'plm', name: 'PLM',
    description: 'Engineering change orders as files in your workspace, submitted, approved, rejected and applied by script, with bill of materials references handed from Manufacturing.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['plm', 'product lifecycle', 'engineering change order', 'eco', 'change management', 'approvals', 'bill of materials'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'PLM', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['plm.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/manufacturing', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'plm' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'plm' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'PLM',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
