// File-based CRM record contracts. Every record is one JSON file whose vendor MIME names its kind.
export const installRoot = '/applications/crm'
export const schemaBase = 'https://schemas.verentis.io/crm/v1'
// Seeds must live outside the app record (installRoot): uninstall removes the record but keeps seed data.
export const settingsPath = '/settings/crm.json'

const vendor = kind => `application/vnd.verentis.crm.${kind}+json`

export const mimeTypes = {
  customers: 'application/vnd.verentis.crm.customers',
  deals: 'application/vnd.verentis.crm.deals',
  cases: 'application/vnd.verentis.crm.cases',
  company: vendor('company'),
  contact: vendor('contact'),
  deal: vendor('deal'),
  case: vendor('case'),
  email: vendor('email'),
  call: vendor('call'),
  meeting: vendor('meeting'),
  task: vendor('task'),
  note: vendor('note'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  customers: { path: '/customers', mime: mimeTypes.customers, holds: ['company', 'contact'] },
  deals: { path: '/deals', mime: mimeTypes.deals, holds: ['deal'] },
  cases: { path: '/cases', mime: mimeTypes.cases, holds: ['case'] },
}

/** Top-level records: named by a generated code (`CUST-0001`), stored without an extension in their container. */
export const recordKinds = ['company', 'contact', 'deal', 'case']
/** Communications: one type per kind, stored under `<record>/activities/`. */
export const activityKinds = ['email', 'call', 'meeting', 'task']
/** Everything stored beneath a record, and the child folder each kind lives in. */
export const childKinds = [...activityKinds, 'note']
export const childFolders = { email: 'activities', call: 'activities', meeting: 'activities', task: 'activities', note: 'notes' }
/** Arbitrary files attached to a record (any type), listed by the record's Documents tab. */
export const documentsFolder = 'documents'
export const allKinds = [...recordKinds, ...childKinds]

/**
 * Code settings for generated record names. Keys are the app's `spec.settings` keys; the create script reads
 * them through the engine SDK. Children are named by UTC timestamp instead, so they sort chronologically.
 */
export const codeSettings = {
  company: { key: 'customer-code-prefix', default: 'CUST-', label: 'Customer code prefix' },
  contact: { key: 'contact-code-prefix', default: 'CON-', label: 'Contact code prefix' },
  deal: { key: 'deal-code-prefix', default: 'DEAL-', label: 'Deal code prefix' },
  case: { key: 'case-code-prefix', default: 'CASE-', label: 'Case code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

const text = { type: 'string', maxLength: 1000 }
const optional = (maxLength = 1000) => ({ type: 'string', maxLength })
const uuid = { type: 'string', format: 'uuid' }
const timestamp = { type: 'string', format: 'date-time', pattern: 'Z$' }
const optionalDate = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' }
// `canvas.form.date` in date-time mode edits local wall-clock values (`2026-01-02T09:30`).
const optionalDateTime = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?Z?)?$' }
const optionalEmail = { type: 'string', maxLength: 254, pattern: '^([^@\\s]+@[^@\\s]+)?$' }
const optionalCountry = { type: 'string', pattern: '^([A-Z]{2})?$' }
const optionalCurrency = { type: 'string', pattern: '^([A-Z]{3})?$' }
const code = { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }
const amount = { type: 'number', minimum: 0, maximum: 1e15 }
const priority = { enum: ['low', 'normal', 'high', 'urgent'] }
const emails = { type: 'array', items: { type: 'string', maxLength: 254 }, maxItems: 100 }

function object(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function array(items, minItems = 0, maxItems = 1000) {
  return { type: 'array', items, minItems, maxItems }
}

/** A reference to another CRM record: its absolute workspace path, plus the stable node id when known. */
export const fileReference = object({
  path: { type: 'string', pattern: '^/', maxLength: 4096 },
  nodeId: uuid,
}, ['path'])

const address = object({
  lines: array({ type: 'string', maxLength: 200 }, 0, 5),
  city: optional(),
  region: optional(),
  postalCode: optional(32),
  country: optionalCountry,
}, [])

export const schemaId = kind => `${schemaBase}/${kind}.schema.json`

function recordSchema(kind, title, properties, required, rules = []) {
  const id = schemaId(kind)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: id,
    title: `CRM ${title}`,
    ...object({
      $schema: { const: id },
      schemaVersion: { const: 1 },
      kind: { const: kind },
      id: uuid,
      state: { enum: ['active', 'archived'] },
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: timestamp,
      ...properties,
    }, ['$schema', 'schemaVersion', 'kind', 'id', 'state', 'createdAt', 'updatedAt', ...required]),
    allOf: [
      { if: { properties: { state: { const: 'archived' } }, required: ['state'] }, then: { properties: { archivedAt: timestamp }, required: ['archivedAt'] } },
      ...rules,
    ],
  }
}

// Every communication records what it is about. The record it sits beneath is the primary one; `regarding` is
// written by the create script so the communication still points home after a move or copy.
const communication = {
  subject: text,
  regarding: fileReference,
  owner: optional(200),
}

const completedRule = (statusValue, field) => ({
  if: { properties: { status: { const: statusValue } }, required: ['status'] },
  then: { properties: { [field]: timestamp }, required: [field] },
})

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  company: recordSchema('company', 'customer', {
    code,
    name: text,
    legalName: optional(),
    type: { enum: ['prospect', 'customer', 'partner', 'supplier', 'other'] },
    industry: optional(200),
    email: optionalEmail,
    phone: optional(100),
    website: optional(2000),
    address,
    taxIdentifier: optional(100),
    owner: optional(200),
    tags: array({ type: 'string', minLength: 1, maxLength: 100 }, 0, 50),
    description: optional(10000),
  }, ['code', 'name', 'type']),
  contact: recordSchema('contact', 'contact', {
    code,
    salutation: optional(50),
    givenName: text,
    familyName: optional(),
    email: optionalEmail,
    phone: optional(100),
    mobile: optional(100),
    jobTitle: optional(),
    department: optional(),
    company: fileReference,
    address,
    owner: optional(200),
    description: optional(10000),
  }, ['code', 'givenName']),
  deal: recordSchema('deal', 'deal', {
    code,
    title: text,
    customer: fileReference,
    contact: fileReference,
    stageId: { type: 'string', minLength: 1, maxLength: 100 },
    amount,
    currency: optionalCurrency,
    probability: { type: 'integer', minimum: 0, maximum: 100 },
    expectedCloseDate: optionalDate,
    outcome: { enum: ['open', 'won', 'lost'] },
    closedAt: timestamp,
    lostReason: optional(1000),
    source: optional(200),
    owner: optional(200),
    description: optional(10000),
  }, ['code', 'title', 'stageId', 'amount', 'currency', 'outcome']),
  case: recordSchema('case', 'case', {
    code,
    subject: text,
    customer: fileReference,
    contact: fileReference,
    status: { enum: ['new', 'open', 'pending', 'resolved', 'closed'] },
    priority,
    type: { enum: ['question', 'problem', 'incident', 'request'] },
    origin: { enum: ['email', 'phone', 'web', 'in-person', 'other'] },
    description: optional(10000),
    resolution: optional(10000),
    resolvedAt: timestamp,
    owner: optional(200),
  }, ['code', 'subject', 'status', 'priority', 'type'], [
    completedRule('resolved', 'resolvedAt'),
    completedRule('closed', 'resolvedAt'),
  ]),
  email: recordSchema('email', 'email', {
    ...communication,
    direction: { enum: ['inbound', 'outbound'] },
    status: { enum: ['draft', 'sent', 'received'] },
    from: optional(254),
    to: emails,
    cc: emails,
    sentAt: optionalDateTime,
    body: optional(100000),
  }, ['subject', 'direction', 'status']),
  call: recordSchema('call', 'call', {
    ...communication,
    direction: { enum: ['inbound', 'outbound'] },
    status: { enum: ['planned', 'held', 'not-held'] },
    phone: optional(100),
    startsAt: optionalDateTime,
    durationMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
    result: optional(1000),
    notes: optional(10000),
  }, ['subject', 'direction', 'status']),
  meeting: recordSchema('meeting', 'meeting', {
    ...communication,
    status: { enum: ['planned', 'held', 'cancelled'] },
    startsAt: optionalDateTime,
    endsAt: optionalDateTime,
    location: optional(500),
    attendees: array({ type: 'string', maxLength: 254 }, 0, 100),
    agenda: optional(10000),
    minutes: optional(50000),
  }, ['subject', 'status']),
  task: recordSchema('task', 'task', {
    ...communication,
    status: { enum: ['not-started', 'in-progress', 'completed', 'deferred'] },
    priority,
    dueDate: optionalDate,
    completedAt: timestamp,
    description: optional(10000),
  }, ['subject', 'status', 'priority'], [completedRule('completed', 'completedAt')]),
  note: recordSchema('note', 'note', {
    title: text,
    regarding: fileReference,
    content: optional(50000),
  }, ['title']),
  settings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: schemaId('settings'),
    title: 'CRM settings',
    ...object({
      $schema: { const: schemaId('settings') },
      schemaVersion: { const: 1 },
      country: optionalCountry,
      currency: optionalCurrency,
      stages: array(object({
        id: { type: 'string', minLength: 1, maxLength: 100 },
        label: { type: 'string', minLength: 1, maxLength: 1000 },
        order: { type: 'integer', minimum: 0 },
        probability: { type: 'integer', minimum: 0, maximum: 100 },
      }, ['id', 'label', 'order']), 1, 50),
    }, ['$schema', 'schemaVersion', 'stages']),
  },
}

const recordTemplate = (kind, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id: '{{ id }}', state: 'active',
  createdAt: '{{ now }}', updatedAt: '{{ now }}', ...fields,
})

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` (records) or the `regarding` reference (children).
 */
export const templates = {
  company: recordTemplate('company', { code: '', name: '{{ name }}', type: 'customer' }),
  contact: recordTemplate('contact', { code: '', givenName: '{{ name }}' }),
  deal: recordTemplate('deal', { code: '', title: '{{ name }}', stageId: 'lead', amount: 0, currency: '', probability: 10, outcome: 'open' }),
  case: recordTemplate('case', { code: '', subject: '{{ name }}', status: 'new', priority: 'normal', type: 'question', origin: 'email' }),
  email: recordTemplate('email', { subject: '{{ name }}', direction: 'outbound', status: 'draft', to: [], cc: [] }),
  call: recordTemplate('call', { subject: '{{ name }}', direction: 'outbound', status: 'planned' }),
  meeting: recordTemplate('meeting', { subject: '{{ name }}', status: 'planned', attendees: [] }),
  task: recordTemplate('task', { subject: '{{ name }}', status: 'not-started', priority: 'normal' }),
  note: recordTemplate('note', { title: '{{ name }}', content: '' }),
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, country: '', currency: '',
  stages: [
    { id: 'lead', label: 'Lead', order: 0, probability: 10 },
    { id: 'qualified', label: 'Qualified', order: 1, probability: 25 },
    { id: 'proposal', label: 'Proposal', order: 2, probability: 50 },
    { id: 'negotiation', label: 'Negotiation', order: 3, probability: 75 },
  ],
}

// Mirrors the platform "New" substitution over a packaged template's text. Every placeholder sits
// inside a JSON string, so values are JSON-escaped to keep names with quotes or backslashes valid.
export function fillTemplate(text, values) {
  return text.replace(/\{\{\s*(id|now|name)\s*\}\}/g, (_, key) => JSON.stringify(String(values[key] ?? '')).slice(1, -1))
}
