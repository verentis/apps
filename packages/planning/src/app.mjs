import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, recordKinds,
  settingsPath, statuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'planning-create'
export const postScript = 'scripts/post'
export const postScriptName = 'planning-post'
/** Where `spec.install` places the shift action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { role: 'roles', shift: 'shifts' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new shifts to the default role' },
]

/** What the shift action script may touch: it publishes and confirms shifts and checks the schedule for overlaps. */
export const postScriptFileAccess = [
  { path: containers.shifts.path, mode: 'write', reason: 'Publish and confirm shifts after checking the employee\'s schedule for overlaps' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  role: {
    singular: 'Shift role', plural: 'Shift roles', titleKey: 'name', icon: 'lucide:tags',
    folderNames: ['shift-roles', 'roles', 'planning'],
    sections: [
      { title: 'Role', fields: [
        text('name', 'Name', { required: true }),
        text('color', 'Color', { placeholder: 'e.g. teal', description: 'A color note used on the schedule.' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
  shift: {
    singular: 'Shift', plural: 'Shifts', titleKey: 'employee', icon: 'lucide:calendar-days', status: 'status',
    folderNames: ['shifts', 'planning'],
    sections: [
      { title: 'Shift', fields: [
        select('employeeRef', 'Employee record', '{{ data.employeeoptions }}', { description: 'Optional. Choose an Employees record, then Copy name.' }),
        text('employee', 'Employee', { required: true, placeholder: 'Name or email' }),
        select('role', 'Role', '{{ data.roleoptions }}'),
        select('status', 'Status', labelled(statuses), { description: 'Published and confirmed are set by Publish and Confirm.', readOnly: 'true' })] },
      { title: 'Schedule', fields: [
        { key: 'date', label: 'Date', type: 'date', required: true },
        text('startTime', 'Start time', { placeholder: '08:00', description: 'Time of day, HH:MM.' }),
        text('endTime', 'End time', { placeholder: '17:00', description: 'Time of day, HH:MM, after the start time.' }),
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }] },
    ],
  },
}

export const settingsSections = [
  { title: 'Defaults', fields: [
    select('defaultRole', 'Default role', '{{ data.roleoptions }}', { span: 2, description: 'New shifts start with this role.' })] },
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
  // Explicit MIME so placeholder templates are never classified as Planning records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'planning', name: 'Planning',
    description: 'Shift planning as files in your workspace: roles and shifts with a week schedule, overlap-checked publishing and confirmed, locked shifts.',
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    readme: './README.md',
    keywords: ['planning', 'shifts', 'schedule', 'roster', 'roles', 'workforce'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Planning', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'week', 'display-name': 'Week schedule', route: '/render?document=.%2Fcanvas%2Fweek.page.yaml', order: 20 },
      { id: 'shifts', 'display-name': 'Shifts', route: '/render?document=.%2Fcanvas%2Fshifts.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['planning.default'],
    settings,
    dependencies: [
      { package: 'verentis/canvas', version: 'latest' },
      { package: 'verentis/nodejs', version: 'latest' },
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'planning' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'planning' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Planning',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
