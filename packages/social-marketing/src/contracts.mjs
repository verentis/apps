// File-based Social Marketing record contracts. Every record is one JSON file whose vendor MIME names its kind.
// Posts are records only: Publish is a stage transition that checks the social account and stamps `publishedAt`;
// actual delivery to the social network's API is a platform integration concern outside this app.
import {
  code, fillTemplate, object, optional, optionalDate, pathOrEmpty,
  schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/social-marketing'
export const schemaBase = 'https://schemas.verentis.io/social-marketing/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the data.
export const settingsPath = '/settings/social-marketing.json'

const vendor = kind => `application/vnd.verentis.social-marketing.${kind}+json`

export const mimeTypes = {
  accounts: 'application/vnd.verentis.social-marketing.accounts',
  posts: 'application/vnd.verentis.social-marketing.posts',
  account: vendor('account'),
  post: vendor('post'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  accounts: { path: '/social-accounts', mime: mimeTypes.accounts, holds: ['account'] },
  posts: { path: '/social-posts', mime: mimeTypes.posts, holds: ['post'] },
}

/** Records are named by a generated code (`SOP-0001`) and stored without an extension in their container. */
export const recordKinds = ['account', 'post']
export const containerOf = { account: 'accounts', post: 'posts' }

export const codeSettings = {
  account: { key: 'account-code-prefix', default: 'SOA-', label: 'Social account code prefix' },
  post: { key: 'post-code-prefix', default: 'SOP-', label: 'Post number prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** The networks a social account can belong to. */
export const networks = ['mastodon', 'linkedin', 'x', 'facebook', 'other']
export const networkLabels = { mastodon: 'Mastodon', linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', other: 'Other' }

/** Post statuses. `scheduled`, `published` and `cancelled` are reached only through the post action script. */
export const statuses = ['draft', 'scheduled', 'published', 'cancelled']
/** The statuses a post can be published or cancelled from. */
export const publishableStatuses = ['draft', 'scheduled']

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Social Marketing')
export { schemaId }

const count = { type: 'integer', minimum: 0, maximum: 1000000000 }
/** Engagement is recorded by hand after publishing; the platform holds no network connection to read it from. */
const engagement = object({ likes: count, shares: count, comments: count })

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  account: recordSchema('account', 'social account', {
    code,
    network: { enum: networks },
    handle: text,
    active: { type: 'boolean' },
  }, ['code', 'network', 'handle', 'active']),
  post: recordSchema('post', 'post', {
    code,
    account: pathOrEmpty,
    content: optional(5000),
    mediaNote: optional(500),
    status: { enum: statuses },
    scheduledDate: optionalDate,
    publishedAt: timestamp,
    cancelledAt: timestamp,
    engagement,
  }, ['code', 'status', 'engagement'], [
    whenStatus(['published'], ['publishedAt']),
    whenStatus(['cancelled'], ['cancelledAt']),
  ]),
  settings: settingsSchema({
    defaultAccount: pathOrEmpty,
  }, ['defaultAccount']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code` and fills the account from the Social Marketing settings.
 */
export const templates = {
  account: recordTemplate('account', { network: 'other', handle: '{{ name }}', active: true }),
  post: recordTemplate('post', {
    account: '', content: '{{ name }}', mediaNote: '', status: 'draft', scheduledDate: '',
    engagement: { likes: 0, shares: 0, comments: 0 },
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  account: {},
  post: {
    account: { file: settingsPath, pointer: 'defaultAccount' },
  },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultAccount: '',
}

export { fillTemplate }
