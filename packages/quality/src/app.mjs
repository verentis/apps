import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, checkTypes, installRoot, mimeTypes,
  recordKinds, severities, alertStages,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'quality-create'
export const postScript = 'scripts/post'
export const postScriptName = 'quality-post'
/** Where `spec.install` places the quality action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { point: 'quality control points', check: 'quality checks', alert: 'quality alerts' }

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = recordKinds.map(kind => ({
  path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code`,
}))

/**
 * What the quality action script may touch: it records checks against their control point's tolerance, raises
 * alerts for failed checks, and resolves alerts conditionally.
 */
export const postScriptFileAccess = [
  { path: containers.points.path, mode: 'read', reason: 'Check a recorded result against its control point and tolerance' },
  { path: containers.checks.path, mode: 'write', reason: 'Record quality check results' },
  { path: containers.alerts.path, mode: 'write', reason: 'Raise a quality alert for a failed check and resolve alerts' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  point: {
    singular: 'Control point', plural: 'Control points', titleKey: 'title', icon: 'lucide:crosshair',
    folderNames: ['quality-control-points', 'control-points', 'quality'],
    sections: [
      { title: 'Control point', fields: [
        text('title', 'Title', { required: true, span: 2 }),
        text('reference', 'Product / operation', { placeholder: 'What this point checks' }),
        text('frequency', 'Frequency', { placeholder: 'e.g. every 10 units' }),
        select('checkType', 'Check type', labelled(checkTypes), { description: 'Measure checks are judged against the tolerance below.' }),
        { key: 'active', label: 'Active', type: 'switch', description: 'Inactive points cannot record checks.' }] },
      { title: 'Measure tolerance', description: 'Only used by measure checks. Exact decimal strings.', fields: [
        text('measureTarget', 'Target', { placeholder: '0' }),
        text('toleranceMin', 'Tolerance min', { placeholder: '0' }),
        text('toleranceMax', 'Tolerance max', { placeholder: '0' })] },
    ],
  },
  check: {
    singular: 'Quality check', plural: 'Quality checks', titleKey: 'reference', icon: 'lucide:clipboard-check', status: 'result',
    folderNames: ['quality-checks', 'checks', 'quality'],
    sections: [
      { title: 'Check', fields: [
        select('point', 'Control point', '{{ data.pointoptions }}', { required: true, span: 2, description: 'The control point this check verifies. Measure points judge the measured value.' }),
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('reference', 'Reference', { placeholder: 'e.g. MO-0001 or PO-0001' })] },
      { title: 'Result', fields: [
        text('measuredValue', 'Measured value', { placeholder: '0', description: 'Required before recording a measure check.' }),
        select('result', 'Result', labelled(['pending', 'pass', 'fail']), { readOnly: 'true', description: 'Set by Record pass and Record fail.' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
  alert: {
    singular: 'Quality alert', plural: 'Quality alerts', titleKey: 'title', icon: 'lucide:siren', status: 'stage',
    folderNames: ['quality-alerts', 'alerts', 'quality'],
    sections: [
      { title: 'Alert', fields: [
        text('title', 'Title', { required: true, span: 2 }),
        select('severity', 'Severity', labelled(severities)),
        select('stage', 'Stage', labelled(alertStages), { description: 'Resolved is set by the Resolve action.' })] },
      { title: 'Analysis', fields: [
        { key: 'rootCause', label: 'Root cause', type: 'textarea', span: 2, description: 'Required before an alert can be resolved.' },
        { key: 'correctiveAction', label: 'Corrective action', type: 'textarea', span: 2, description: 'Required before an alert can be resolved.' }] },
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
    id: 'quality', name: 'Quality',
    description: 'Quality control points, checks and alerts as files in your workspace, recorded against tolerances and resolved by script.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['quality', 'qc', 'quality control', 'checks', 'alerts', 'tolerance', 'non-conformance'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Quality', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'checks', 'display-name': 'Quality checks', route: `/render?document=${encodeURIComponent('./canvas/checks.page.yaml')}`, order: 20 },
      { id: 'alerts', 'display-name': 'Quality alerts', route: `/render?document=${encodeURIComponent('./canvas/alerts.page.yaml')}`, order: 30 },
      { id: 'points', 'display-name': 'Control points', route: `/render?document=${encodeURIComponent('./canvas/points.page.yaml')}`, order: 40 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['quality.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'quality' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'quality' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Quality',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    ...(createDefaults[kind] ? { defaults: createDefaults[kind] } : {}),
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
