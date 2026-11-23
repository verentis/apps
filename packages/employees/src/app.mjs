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
export const createScriptName = 'employees-create'
export const postScript = 'scripts/post'
export const postScriptName = 'employees-post'
/** Where `spec.install` places the employee action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { department: 'departments', employee: 'employees' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new employees to the default department' },
]

/** What the employee action script may touch: it terminates employees conditionally, reading nothing else. */
export const postScriptFileAccess = [
  { path: containers.employees.path, mode: 'write', reason: 'Mark active employees terminated with their termination date' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  department: {
    singular: 'Department', plural: 'Departments', titleKey: 'name', icon: 'lucide:building-2',
    folderNames: ['departments', 'employees', 'hr'],
    sections: [
      { title: 'Department', fields: [
        text('name', 'Name', { required: true }),
        select('manager', 'Manager', '{{ data.employeeoptions }}', { description: 'The employee who manages this department.' })] },
    ],
  },
  employee: {
    singular: 'Employee', plural: 'Employees', titleKey: 'name', icon: 'lucide:user-round', status: 'status',
    folderNames: ['employees', 'hr', 'staff'],
    sections: [
      { title: 'Person', fields: [
        text('name', 'Name', { required: true }),
        text('jobTitle', 'Job title')] },
      { title: 'Organization', fields: [
        select('department', 'Department', '{{ data.departmentoptions }}'),
        select('manager', 'Manager', '{{ data.manageroptions }}')] },
      { title: 'Contact', fields: [
        { key: 'workEmail', label: 'Work email', type: 'email' },
        text('workPhone', 'Work phone')] },
      { title: 'Employment', fields: [
        { key: 'startDate', label: 'Start date', type: 'date' },
        select('status', 'Status', labelled(statuses), { description: 'Terminated is set by the Terminate action.' }),
        { key: 'terminationDate', label: 'Termination date', type: 'date', readOnly: 'true',
          description: 'Set by the Terminate action.' }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultDepartment', label: 'Default department', type: 'select', options: '{{ data.departmentoptions }}', span: 2,
    description: 'New employees start in this department.' },
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
  // Explicit MIME so placeholder templates are never classified as Employees records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  // A starter department and sample employees, seeded once and kept on upgrade and uninstall.
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
    id: 'employees', name: 'Employees',
    description: "Build a company directory that shows who works where.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Employees cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Employees overview in Canvas", "caption": "Employees overview"}, {"source": "./marketplace/detail.png", "alt": "Directory in Canvas", "caption": "Directory"}],
    readme: "./marketplace/README.md",
    keywords: ['employees', 'hr', 'human resources', 'departments', 'directory', 'staff'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Employees', route: `/render?document=${encodeURIComponent('./canvas/home.page.yaml')}`, order: 10 },
      { id: 'directory', 'display-name': 'Directory', route: `/render?document=${encodeURIComponent('./canvas/directory.page.yaml')}`, order: 20 },
      { id: 'departments', 'display-name': 'Departments', route: `/render?document=${encodeURIComponent('./canvas/departments.page.yaml')}`, order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['employees.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'employees' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'employees' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Employees',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
