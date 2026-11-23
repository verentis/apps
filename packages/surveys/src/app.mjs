import {
  codeDigits, codeSettings, containerOf, containers, createDefaults, installRoot, mimeTypes, questionKinds,
  ratingMax, recordKinds, responseStatuses, settingsPath, surveyStatuses,
} from './contracts.mjs'
import { scriptConsent } from '../../../tools/file-apps/build.mjs'

export const version = '0.1.0'
export const canvasOrigin = 'https://canvas.apps.localtest.me'
// Canvas is hosted by the canvas repository. The feature apps domain is supplied at publish time; production is
// the region-free host.
export const featureCanvasOrigin = 'https://canvas.${param:apps-domain}'
export const productionCanvasOrigin = 'https://canvas.apps.verentis.io'
export const createScript = 'scripts/create'
export const createScriptName = 'surveys-create'
export const postScript = 'scripts/post'
export const postScriptName = 'surveys-post'
/** Where `spec.install` places the action script; Canvas actions run it by path. */
export const postScriptPath = `${installRoot}/${postScript}`

const plural = { survey: 'surveys', response: 'responses' }

/** What the create script may touch: it writes new records create-only and reads the defaults they start with. */
export const createScriptFileAccess = [
  ...recordKinds.map(kind => ({ path: containers[containerOf[kind]].path, mode: 'write', reason: `Create ${plural[kind]} with the next code` })),
  { path: settingsPath, mode: 'read', reason: 'Default new responses to the default survey' },
]

/** What the action script may touch: it opens and closes surveys and submits responses conditionally. */
export const postScriptFileAccess = [
  { path: containers.surveys.path, mode: 'write', reason: 'Open and close surveys, and read their questions when submitting' },
  { path: containers.responses.path, mode: 'write', reason: 'Submit responses after validating their answers' },
]

const text = (key, label, extra = {}) => ({ key, label, ...extra })
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
const labelled = values => values.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }))

/** Record kinds: labels, icons and the sections of their bound Canvas form. `span: 2` fields take a full row. */
export const entities = {
  survey: {
    singular: 'Survey', plural: 'Surveys', titleKey: 'title', icon: 'lucide:clipboard-list', status: 'status',
    folderNames: ['surveys'],
    sections: [
      { title: 'Survey', fields: [text('title', 'Title', { required: true, span: 2 }),
        select('status', 'Status', labelled(surveyStatuses), { description: 'Open and closed are set by Open and Close.' }),
        { key: 'description', label: 'Description', type: 'textarea', span: 2, rows: 4 }] },
      { title: 'Questions', description: `Each question needs a unique sequence. Choice kinds need at least two choices; ratings run 1 to ${ratingMax}.`, fields: [
        { key: 'questions', label: 'Questions', type: 'rows', maximum: 100, span: 2, addLabel: 'Add question',
          defaultRow: { sequence: 1, text: '', kind: 'text', choices: [], required: false },
          fields: [
            { key: 'sequence', label: 'Sequence', type: 'number', required: true },
            { key: 'text', label: 'Question', required: true },
            { key: 'kind', label: 'Kind', type: 'select', options: labelled(questionKinds) },
            { key: 'choices', label: 'Choices', type: 'text-list' },
            { key: 'required', label: 'Required', type: 'checkbox' },
          ] }] },
    ],
  },
  response: {
    singular: 'Response', plural: 'Responses', titleKey: 'respondentName', icon: 'lucide:message-square-text', status: 'status',
    folderNames: ['survey-responses', 'responses', 'surveys'],
    sections: [
      { title: 'Response', fields: [
        select('survey', 'Survey', '{{ data.surveyoptions }}', { span: 2, description: 'The survey this response answers.' }),
        text('respondentName', 'Respondent name'),
        text('respondentEmail', 'Respondent email', { type: 'email' }),
        select('status', 'Status', labelled(responseStatuses), { description: 'Submitted is set by Submit, which locks the response.' }),
        text('submittedAt', 'Submitted at', { readOnly: 'true', description: 'Stamped by Submit.' })] },
      { title: 'Answers', description: `One row per answered question sequence. Use value for text, ratings (1-${ratingMax}) and single choices; values for multiple choices.`, fields: [
        { key: 'answers', label: 'Answers', type: 'rows', maximum: 100, span: 2, addLabel: 'Add answer',
          defaultRow: { sequence: 1, value: '', values: [] },
          fields: [
            { key: 'sequence', label: 'Question sequence', type: 'number', required: true },
            { key: 'value', label: 'Value' },
            { key: 'values', label: 'Values', type: 'text-list' },
          ] }] },
    ],
  },
}

export const settingsFields = [
  { key: 'defaultSurvey', label: 'Default survey', type: 'select', options: '{{ data.surveyoptions }}', span: 2,
    description: 'New responses start against this survey.' },
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
  // Explicit MIME so placeholder templates are never classified as Surveys records by their $schema.
  { from: 'templates/*.json', to: `${installRoot}/templates/`, mode: 'managed', mime: 'application/json' },
  ...Object.entries(containers).map(([name, container]) => ({ from: `seed/${name}`, to: container.path, mode: 'seed', mime: container.mime })),
  { from: 'seed/settings.json', to: settingsPath, mode: 'seed', mime: mimeTypes.settings },
]

export const manifest = {
  'api-version': 'verentis.io/v1',
  kind: 'Application',
  metadata: {
    id: 'surveys', name: 'Surveys',
    description: "Collect structured feedback and review the answers question by question.",
    icon: './icons/app.svg', version, author: 'Verentis',
  },
  marketplace: {
    logo: "./icons/app.svg",
    hero: {"source": "./marketplace/hero.svg", "alt": "Surveys cover"},
    images: [{"source": "./marketplace/overview.png", "alt": "Surveys overview in Canvas", "caption": "Surveys overview"}, {"source": "./marketplace/detail.png", "alt": "All surveys in Canvas", "caption": "All surveys"}],
    readme: "./marketplace/README.md",
    keywords: ['surveys', 'questionnaires', 'responses', 'feedback', 'polls', 'ratings'],
  },
  spec: {
    'install-root': installRoot,
    entry: canvasOrigin,
    scope: 'global',
    'entry-points': [
      { id: 'home', 'display-name': 'Surveys', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 },
      { id: 'surveys', 'display-name': 'All surveys', route: '/render?document=.%2Fcanvas%2Fsurveys.page.yaml', order: 20 },
      { id: 'results', 'display-name': 'Results', route: '/render?document=.%2Fcanvas%2Fresults.page.yaml', order: 30 },
    ],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    permissions: ['file.read', 'file.write', 'execution.run'],
    scopes: ['surveys.default'],
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
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'surveys' },
  spec: { entry: featureCanvasOrigin },
  packaging: { variables: { 'canvas-origin': featureCanvasOrigin } },
}

export const productionOverlay = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: { id: 'surveys' },
  spec: { entry: productionCanvasOrigin },
  packaging: { variables: { 'canvas-origin': productionCanvasOrigin } },
}

export const scriptConsents = [
  ...scriptConsent(createScriptName, createScriptFileAccess),
  ...scriptConsent(postScriptName, postScriptFileAccess),
]

/** What the create script needs to know about each kind (generated into `scripts/create/config.mjs`). */
export const createScriptConfig = {
  app: 'Surveys',
  kinds: Object.fromEntries(recordKinds.map(kind => [kind, {
    code: { key: codeSettings[kind].key, default: codeSettings[kind].default },
    defaults: createDefaults[kind],
  }])),
  codeDigits: { key: codeDigits.key, default: codeDigits.default },
  writableRoots: createScriptFileAccess.filter(grant => grant.mode === 'write').map(grant => grant.path),
  settingsFiles: [settingsPath],
}
