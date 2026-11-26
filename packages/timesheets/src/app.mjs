import { employeeLink } from '../../../tools/file-apps/canvas.mjs'
import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds, settingsPath,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'timesheets-create'
export const postScript = 'scripts/post'
export const postScriptName = 'timesheets-post'
/** Where `spec.install` places the validation script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

/** What the create script may touch: it writes new entries create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  { path: containers.entries.path, mode: 'write', reason: 'Create timesheet entries with the next code' },
  { path: settingsPath, mode: 'read', reason: 'Default new entries\' employee name' },
]

/** What the validation script may touch: it marks entries validated with a conditional write. */
export const postScriptFileAccess = [
  { path: containers.entries.path, mode: 'write', reason: 'Mark timesheet entries validated with their validation time' },
  { path: '/employees', mode: 'read', reason: 'Check the linked employee still exists and is not terminated (when Employees is installed)' },
]


/** The entry's person: an Employees record when Employees is installed (the picker fills the name), else a name. */
export const employee = employeeLink('employeeRef', 'employee')

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  entry: {
    singular: 'Timesheet entry', plural: 'Timesheet entries', titleKey: 'employee', icon: 'lucide:clock', status: 'status',
    folderNames: ['timesheets', 'timesheet'],
    sections: [
      { title: 'Entry', fields: [
        text('employee', 'Employee', { required: true }),
        employee.field,
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('hours', 'Hours', { placeholder: '7.5', required: true, description: 'A decimal number of hours, e.g. 7.5.' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2 }] },
      { title: 'Work', description: 'Optional. Projects and tasks come from the Project app, when it is installed.', fields: [
        select('project', 'Project', '{{ data.projectoptions }}'),
        select('task', 'Task', '{{ data.taskoptions }}')] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', fields: [
    text('employee', 'Employee', { description: 'Used for new entries only when the person creating them is not known.' })] },
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
  // Explicit MIME so placeholder templates are never classified as records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'timesheets', name: 'Timesheets',
    description: "Record working time and review how the week was spent.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Timesheets cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Timesheets overview in Canvas", "caption": "Timesheets overview"}, {"source": "./marketplace/detail.png", "alt": "This week in Canvas", "caption": "This week"}],
    readme: "./marketplace/README.md",
    keywords: ['timesheets', 'time tracking', 'hours', 'projects', 'tasks'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Timesheets', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'week', 'display-name': 'This week', route: '/render?document=.%2Fcanvas%2Fweek.page.yaml', order: 20 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['timesheets.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
      { package: 'verentis/project', version: 'latest', optional: true },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'timesheets' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'timesheets' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Timesheets',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
