// File-based Knowledge record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fillTemplate, optional, pathOrEmpty, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/knowledge'
export const schemaBase = 'https://schemas.verentis.io/knowledge/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the articles.
export const settingsPath = '/settings/knowledge.json'
/**
 * Article bodies are Markdown strings (the platform's `text/markdown` building block, as rendered by the
 * Markdown Viewer app) — not a Knowledge-specific rich-text format.
 */
export const bodyMediaType = 'text/markdown'

const vendor = kind => `application/vnd.verentis.knowledge.${kind}+json`

export const mimeTypes = {
  spaces: 'application/vnd.verentis.knowledge.spaces',
  articles: 'application/vnd.verentis.knowledge.articles',
  space: vendor('space'),
  article: vendor('article'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  spaces: { path: '/knowledge-spaces', mime: mimeTypes.spaces, holds: ['space'] },
  articles: { path: '/articles', mime: mimeTypes.articles, holds: ['article'] },
}

/** Records are named by a generated code (`KA-0001`) and stored without an extension in their container. */
export const recordKinds = ['space', 'article']
export const containerOf = { space: 'spaces', article: 'articles' }

export const codeSettings = {
  space: { key: 'space-code-prefix', default: 'KS-', label: 'Space code prefix' },
  article: { key: 'article-code-prefix', default: 'KA-', label: 'Article code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Article lifecycle. `published` and `archived` are reached only through the publish and archive script actions. */
export const statuses = ['draft', 'published', 'archived']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Knowledge')
export { schemaId }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  space: recordSchema('space', 'space', {
    code,
    name: text,
    description: optional(2000),
    icon: optional(100),
  }, ['code', 'name', 'description', 'icon']),
  article: recordSchema('article', 'article', {
    code,
    title: text,
    space: pathOrEmpty,
    parent: pathOrEmpty,
    body: { type: 'string', maxLength: 200000, contentMediaType: bodyMediaType },
    tags: array({ type: 'string', maxLength: 50 }, 0, 20),
    status: { enum: statuses },
    owner: optional(200),
    publishedAt: timestamp,
  }, ['code', 'title', 'body', 'tags', 'status'], [
    whenStatus(['published'], ['publishedAt']),
  ]),
  settings: settingsSchema({
    defaultSpace: pathOrEmpty,
  }, ['defaultSpace']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the space from the Knowledge settings.
 */
export const templates = {
  space: recordTemplate('space', { name: '{{ name }}', description: '', icon: '' }),
  article: recordTemplate('article', {
    title: '{{ name }}', space: '', parent: '', body: '', tags: [], status: 'draft', owner: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  space: {},
  article: { space: { file: settingsPath, pointer: 'defaultSpace' } },
}

const seedTime = '2026-01-01T00:00:00Z'
const seedSpacePath = `${containers.spaces.path}/KS-0001`
const seedWelcomePath = `${containers.articles.path}/KA-0001`
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** A starter space and a few articles — one nested — seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('space', 'KS-0001', '9e2a4b6c-1d3f-4a5b-8c7d-0e1f2a3b4c01', {
    name: 'Company handbook', description: 'Policies, onboarding and how the team works.', icon: 'book',
  }),
  seedRecord('article', 'KA-0001', '9e2a4b6c-1d3f-4a5b-8c7d-0e1f2a3b4c02', {
    title: 'Welcome to the handbook', space: seedSpacePath, parent: '',
    body: '# Welcome\n\nThis handbook collects everything the team needs to know.\n\n- Articles are **Markdown** files you edit in their form.\n- Draft articles become visible to everyone once **published**.\n- Outdated articles are **archived**, never deleted.\n',
    tags: ['handbook', 'welcome'], status: 'published', owner: 'Avery Adams', publishedAt: seedTime,
  }),
  seedRecord('article', 'KA-0002', '9e2a4b6c-1d3f-4a5b-8c7d-0e1f2a3b4c03', {
    title: 'Getting around the workspace', space: seedSpacePath, parent: seedWelcomePath,
    body: '## Finding things\n\nArticles live in `/articles`; spaces group them. Use the Spaces page to browse the hierarchy.\n',
    tags: ['handbook', 'workspace'], status: 'published', owner: 'Avery Adams', publishedAt: seedTime,
  }),
  seedRecord('article', 'KA-0003', '9e2a4b6c-1d3f-4a5b-8c7d-0e1f2a3b4c04', {
    title: 'Expense policy', space: seedSpacePath, parent: '',
    body: 'Draft of the expense policy. Add the approval thresholds before publishing.\n',
    tags: ['policy', 'finance'], status: 'draft', owner: 'Jordan Jacobs',
  }),
]
export const starterSpace = starterRecords[0]
export const starterArticles = starterRecords.filter(record => record.kind === 'article')

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultSpace: seedSpacePath,
}

export { fillTemplate }
