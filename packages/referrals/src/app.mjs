import { employeeLink } from '../../../tools/file-apps/canvas.mjs'
import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'


/** Who referred: an Employees record when Employees is installed (the picker fills the name), else a name. */
export const referrer = employeeLink('referrerRef', 'referrerName')

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'referrals-create'
export const postScript = 'scripts/post'
export const postScriptName = 'referrals-post'
/** Where `spec.install` places the referral action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new records create-only. */
export const createScriptFileAccess = [
  { path: containers.referrals.path, mode: 'write', reason: 'Create referrals with the next code' },
]

/** What the referral action script may touch: it decides referrals conditionally and reads the points to award. */
export const postScriptFileAccess = [
  { path: containers.referrals.path, mode: 'write', reason: 'Mark referrals hired or not hired' },
  { path: settingsPath, mode: 'read', reason: 'Read the points a hire awards' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  referral: {
    singular: 'Referral', plural: 'Referrals', titleKey: 'candidateName', icon: 'lucide:gift', status: 'status',
    folderNames: ['referrals', 'hr'],
    sections: [
      { title: 'Referral', fields: [
        text('candidateName', 'Candidate', { required: true }),
        select('status', 'Status', labelled(statuses), { description: 'Hired and Not Hired are set by Mark hired and Mark not hired.' }),
        { key: 'job', label: 'Job position', type: 'select', options: '{{ data.joboptions }}',
          description: 'Optional. A Recruitment job position (when Recruitment is installed).' },
        { key: 'points', label: 'Points', type: 'number', min: 0, readOnly: 'true',
          description: 'Awarded by Mark hired from the Referrals settings.' }] },
      { title: 'Referrer', fields: [
        text('referrerName', 'Referrer', { required: true }),
        referrer.field] },
      { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 6 }] },
    ],
  },
}

export const settingsFields = [
  { key: 'hirePoints', label: 'Points per hire', type: 'number', min: 0, max: 100000, span: 2,
    description: 'Mark hired awards this many points to the referral.' },
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
  // Explicit MIME so placeholder templates are never classified as Referrals records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'referrals', name: 'Referrals',
    description: "Track employee referrals and recognise the people behind successful hires.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Referrals cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Referrals overview in Canvas", "caption": "Referrals overview"}, {"source": "./marketplace/detail.png", "alt": "Leaderboard in Canvas", "caption": "Leaderboard"}],
    readme: "./marketplace/README.md",
    keywords: ['referrals', 'recruitment', 'hiring', 'points', 'leaderboard', 'hr'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Referrals', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'referrals', 'display-name': 'By status', route: '/render?document=.%2Fcanvas%2Freferrals.page.yaml', order: 20 },
      { id: 'leaderboard', 'display-name': 'Leaderboard', route: '/render?document=.%2Fcanvas%2Fleaderboard.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['referrals.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/recruitment', version: 'latest', optional: true },
      { package: 'verentis/employees', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'referrals' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'referrals' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Referrals',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [],
}
