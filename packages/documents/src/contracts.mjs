// File-based Documents record contracts. Documents is a thin tagging and workflow layer over the platform VFS:
// every record is one small JSON file whose vendor MIME names its kind, and a document card only *references* a
// file that already lives in the workspace (`filePath`). The app never stores, copies or versions file content —
// the VFS does that natively.
import {
  array, code, fillTemplate, optional, pathOrEmpty, schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/documents'
export const schemaBase = 'https://schemas.verentis.io/documents/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the cards.
export const settingsPath = '/settings/documents.json'

const vendor = kind => `application/vnd.verentis.documents.${kind}+json`

export const mimeTypes = {
  workspaces: 'application/vnd.verentis.documents.workspaces',
  cards: 'application/vnd.verentis.documents.cards',
  tags: 'application/vnd.verentis.documents.tags',
  workspace: vendor('workspace'),
  document: vendor('document'),
  tag: vendor('tag'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  workspaces: { path: '/document-workspaces', mime: mimeTypes.workspaces, holds: ['workspace'] },
  cards: { path: '/document-cards', mime: mimeTypes.cards, holds: ['document'] },
  tags: { path: '/document-tags', mime: mimeTypes.tags, holds: ['tag'] },
}

/** Records are named by a generated code (`DOC-0001`) and stored without an extension in their container. */
export const recordKinds = ['workspace', 'document', 'tag']
export const containerOf = { workspace: 'workspaces', document: 'cards', tag: 'tags' }

export const codeSettings = {
  workspace: { key: 'workspace-code-prefix', default: 'DWS-', label: 'Workspace code prefix' },
  document: { key: 'document-code-prefix', default: 'DOC-', label: 'Document number prefix' },
  tag: { key: 'tag-code-prefix', default: 'DTG-', label: 'Tag code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/**
 * Document card workflow statuses. `in-review`, `validated` and `archived-status` are reached only through the
 * scripted actions (send to review, validate, archive, return to inbox); validated and archived cards lock their
 * form. `archived-status` is the workflow status and is distinct from the record `state: archived`.
 */
export const statuses = ['inbox', 'in-review', 'validated', 'archived-status']
export const statusLabels = { inbox: 'Inbox', 'in-review': 'In review', validated: 'Validated', 'archived-status': 'Archived' }

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Documents')
export { schemaId }

/** A tag applied to a document card: the label of a tag definition, or any ad-hoc label. */
const tagValue = { type: 'string', maxLength: 100 }

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  workspace: recordSchema('workspace', 'workspace', {
    code,
    name: text,
    description: optional(2000),
    defaultTags: array(tagValue, 0, 50),
  }, ['code', 'name', 'defaultTags']),
  document: recordSchema('document', 'document card', {
    code,
    title: text,
    // The VFS path of the file this card describes. The file itself is stored and versioned by the VFS.
    filePath: pathOrEmpty,
    workspace: pathOrEmpty,
    tags: array(tagValue, 0, 50),
    owner: optional(200),
    status: { enum: statuses },
    notes: optional(10000),
    reviewComment: optional(2000),
    validatedAt: timestamp,
  }, ['code', 'title', 'filePath', 'workspace', 'tags', 'status'], [
    whenStatus(['validated', 'archived-status'], ['validatedAt']),
  ]),
  tag: recordSchema('tag', 'tag', {
    code,
    label: text,
    category: optional(100),
  }, ['code', 'label']),
  settings: settingsSchema({
    defaultWorkspace: pathOrEmpty,
  }, ['defaultWorkspace']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds the
 * generated `code`, fills the workspace from settings and defaults the tags from the workspace's `defaultTags`.
 */
export const templates = {
  workspace: recordTemplate('workspace', { name: '{{ name }}', description: '', defaultTags: [] }),
  document: recordTemplate('document', {
    title: '{{ name }}', filePath: '', workspace: '', tags: [], owner: '', status: 'inbox',
    notes: '', reviewComment: '',
  }),
  tag: recordTemplate('tag', { label: '{{ name }}', category: '' }),
}

/** Defaults the create script fills into empty template fields; the tags follow from the workspace. */
export const createDefaults = {
  workspace: {},
  document: { workspace: { file: settingsPath, pointer: 'defaultWorkspace' } },
  tag: {},
}

const seedTime = '2026-01-01T00:00:00Z'
const seedWorkspacePaths = {
  finance: `${containers.workspaces.path}/DWS-0001`,
  legal: `${containers.workspaces.path}/DWS-0002`,
}
const seedRecord = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** Two starter workspaces, a tag set and sample document cards, seeded once so the pages have something to show. */
export const starterRecords = [
  seedRecord('workspace', 'DWS-0001', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f01', {
    name: 'Finance', description: 'Invoices, statements and payment proofs.', defaultTags: ['finance', 'invoice'],
  }),
  seedRecord('workspace', 'DWS-0002', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f02', {
    name: 'Legal', description: 'Contracts, agreements and policies.', defaultTags: ['legal', 'contract'],
  }),
  seedRecord('tag', 'DTG-0001', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f03', { label: 'finance', category: 'department' }),
  seedRecord('tag', 'DTG-0002', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f04', { label: 'invoice', category: 'document-type' }),
  seedRecord('tag', 'DTG-0003', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f05', { label: 'legal', category: 'department' }),
  seedRecord('tag', 'DTG-0004', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f06', { label: 'contract', category: 'document-type' }),
  seedRecord('document', 'DOC-0001', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f07', {
    title: 'Acme invoice March', filePath: '/shared/finance/acme-invoice-march.pdf',
    workspace: seedWorkspacePaths.finance, tags: ['finance', 'invoice'], owner: 'Avery Adams',
    status: 'inbox', notes: 'Dropped off by procurement.', reviewComment: '',
  }),
  seedRecord('document', 'DOC-0002', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f08', {
    title: 'Globex master agreement', filePath: '/shared/legal/globex-msa.pdf',
    workspace: seedWorkspacePaths.legal, tags: ['legal', 'contract'], owner: 'Jordan Jacobs',
    status: 'in-review', notes: 'Renewal for 2026.', reviewComment: '',
  }),
  seedRecord('document', 'DOC-0003', '9d2e3f4a-5b6c-4d7e-9f0a-1b2c3d4e5f09', {
    title: 'Initech statement Q4', filePath: '/shared/finance/initech-statement-q4.pdf',
    workspace: seedWorkspacePaths.finance, tags: ['finance'], owner: 'Avery Adams',
    status: 'validated', notes: '', reviewComment: '', validatedAt: seedTime,
  }),
]
export const starterWorkspaces = starterRecords.filter(record => record.kind === 'workspace')
export const starterTags = starterRecords.filter(record => record.kind === 'tag')
export const starterDocuments = starterRecords.filter(record => record.kind === 'document')

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultWorkspace: seedWorkspacePaths.finance,
}

export { fillTemplate }
