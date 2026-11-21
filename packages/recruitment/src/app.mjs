import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, jobStatuses, mimeTypes,
  recordKinds, settingsPath, sources, stages,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'recruitment-create'
export const postScript = 'scripts/post'
export const postScriptName = 'recruitment-post'
/** Where `spec.install` places the candidate action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { job: 'job positions', candidate: 'candidates' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new candidates to the default job position' },
]

/** What the candidate action script may touch: it advances, refuses and hires candidates conditionally. */
export const postScriptFileAccess = [
  { path: containers.candidates.path, mode: 'write', reason: 'Advance, refuse and hire candidates' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  job: {
    singular: 'Job position', plural: 'Job positions', titleKey: 'title', icon: 'lucide:briefcase', status: 'status',
    folderNames: ['job-positions', 'jobs', 'recruitment'],
    sections: [
      { title: 'Position', fields: [text('title', 'Title', { required: true, span: 2 }),
        text('department', 'Department'),
        select('status', 'Status', labelled(jobStatuses)),
        { key: 'openings', label: 'Openings', type: 'number', min: 0, max: 1000, required: true,
          description: 'How many hires this position is recruiting for.' }] },
    ],
  },
  candidate: {
    singular: 'Candidate', plural: 'Candidates', titleKey: 'name', icon: 'lucide:user-round', status: 'stage',
    folderNames: ['candidates', 'applications', 'recruitment'],
    sections: [
      { title: 'Candidate', fields: [text('name', 'Name', { required: true, span: 2 }),
        { key: 'job', label: 'Job position', type: 'select', options: '{{ data.joboptions }}' },
        select('source', 'Source', labelled(sources)),
        text('email', 'Email', { type: 'email' }),
        text('phone', 'Phone'),
        select('stage', 'Stage', labelled(stages), { description: 'Hired and Refused are set by Hire and Refuse.' }),
        text('expectedSalary', 'Expected salary', { placeholder: 'e.g. 45000.00' })] },
      { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 6 },
        { key: 'refusalReason', label: 'Refusal reason', type: 'textarea', span: 2,
          description: 'Required before a candidate can be refused.' }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultJob', label: 'Default job position', type: 'select', options: '{{ data.joboptions }}', span: 2,
    description: 'New candidates start applied to this position.' },
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
    id: kind, 'display-name': entity.singular, description: `A new recruitment ${entity.singular.toLowerCase()}`,
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
  // Explicit MIME so placeholder templates are never classified as Recruitment records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'recruitment', name: 'Recruitment',
    description: 'Job positions and candidates as files in your workspace, with a hiring pipeline and scripted advance, refuse and hire actions.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['recruitment', 'hiring', 'candidates', 'jobs', 'applications', 'hr', 'pipeline'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Recruitment', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'pipeline', 'display-name': 'Pipeline', route: '/render?document=.%2Fcanvas%2Fpipeline.page.yaml', order: 20 },
      { id: 'positions', 'display-name': 'Positions', route: '/render?document=.%2Fcanvas%2Fpositions.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['recruitment.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'recruitment' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'recruitment' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Recruitment',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
