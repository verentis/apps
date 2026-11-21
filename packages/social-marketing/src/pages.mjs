// Generates the Social Marketing Canvas documents: a bound form per record kind, the settings form, the launch
// page, the upcoming-posts page and the per-account engagement page. Scheduling, publishing and cancelling
// (status transitions, account checks, locking) are done by the action script the post form runs.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import {
  containers, installRoot, mimeTypes, networkLabels, publishableStatuses, recordKinds, schemaId, settingsPath,
  statuses,
} from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['published'], warning: ['scheduled'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Social Marketing schemas and run the post action script' }
const published = "form.values.status === 'published'"
const closed = `${published} || form.values.status === 'cancelled'`
const idle = 'form.saving || form.dirty'
const publishable = `${JSON.stringify(publishableStatuses)}.includes(form.values.status)`

const accountSources = {
  accounts: folder(containers.accounts.path, mimeTypes.account),
  accountoptions: { kind: 'computed', expr: options('accounts', "e.data.handle || ''") },
}
const accountsAccess = reason => ({ path: containers.accounts.path, reason })

/** Bound form controls; `switch` is a local extension for boolean fields. */
function control(field, readOnly) {
  if (field.type !== 'switch') return formControl(field, readOnly)
  return {
    type: 'canvas.form.switch',
    props: { label: field.label, value: `{{ form.values.${field.key} }}`, ...(field.description ? { description: field.description } : {}) },
    ...(field.span === 2 ? { layout: { tablet: { colSpan: 2 } } } : {}),
    ...(readOnly ? { rules: { disabled: readOnly } } : {}),
  }
}

/** A section's `lock` picks when its fields freeze: posts close on publish/cancel, engagement opens on publish. */
const sectionReadOnly = section => section.lock === 'closed' ? `${archived} || (${closed})`
  : section.lock === 'engagement' ? `${archived} || !(${published})`
  : archived
const sectionCards = sections =>
  sections.map(section => card(section.title, [grid(section.fields.map(field => control(field, sectionReadOnly(section))))], section.description))

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'account') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [accountsAccess('Choose the social account a post is published through'), schemaAccess],
    data: accountSources,
    notices: [
      { ...text('This post was published on {{ form.values.publishedAt }}. Its account, schedule and content are locked; record the engagement below.', 'muted'),
        rules: { visible: published } },
      { ...text('This post was cancelled.', 'muted'), rules: { visible: "form.values.status === 'cancelled'" } },
    ],
    buttons: [
      button('Schedule', 'schedule', { visible: `form.values.status === 'draft' && !(${archived})`,
        disabled: `${idle} || !form.values.scheduledDate` }, 'outline', 'calendar-clock'),
      button('Publish', 'publish', { visible: `${publishable} && !(${archived})`,
        disabled: `${idle} || !(form.values.content || '').trim()` }, undefined, 'megaphone'),
      button('Cancel', 'cancel', { visible: `${publishable} && !(${archived})`, disabled: idle }, 'ghost', 'x'),
    ],
    actions: {
      schedule: scriptAction(postScriptPath, 'schedule', {
        confirm: { title: 'Schedule post', message: 'Schedule this post for its scheduled date? Publishing stays a manual action.' },
      }),
      publish: scriptAction(postScriptPath, 'publish', {
        confirm: { title: 'Publish post', message: 'Mark this post published? Its content is locked and delivery to the network is a platform integration.' },
      }),
      cancel: scriptAction(postScriptPath, 'cancel', {
        confirm: { title: 'Cancel post', message: 'Cancel this post? It can no longer be scheduled or published.' },
      }),
    },
    // Save stays available after publishing so the engagement counts can be recorded.
    locked: 'false',
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...extras.buttons, recordButtons(extras.locked)]),
  ], 'between')
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...extras.notices,
    grid(sectionCards(entity.sections)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `social-marketing-${kind}`, displayName: `Social Marketing ${entity.singular.toLowerCase()}`,
      description: `View and edit a Social Marketing ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'social-marketing-settings', displayName: 'Social Marketing settings', description: 'Edit the Social Marketing settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [accountsAccess('Choose the default social account for new posts'), schemaAccess],
      data: accountSources,
      tree: [
        row([
          column([heading('Social Marketing settings'), text('Defaults for new posts. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        ...status('accounts', `The ${containers.accounts.path} folder could not be read. Reinstall Social Marketing to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active post flattened for the pages: status, account path and handle, schedule and engagement facts.
const postRows = `(data.posts || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, accountPath: e.data.account || '', handle: ((((data.accounts || []).find(a => a.kind === 'file' && a.data && a.path === e.data.account) || {}).data || {}).handle) || '', status: e.data.status || '', scheduledDate: e.data.scheduledDate || '', publishedAt: e.data.publishedAt || '', excerpt: String(e.data.content || '').slice(0, 80), likes: Number((e.data.engagement || {}).likes || 0), shares: Number((e.data.engagement || {}).shares || 0), comments: Number((e.data.engagement || {}).comments || 0) }))`
const postSources = {
  posts: folder(containers.posts.path, mimeTypes.post),
  accounts: folder(containers.accounts.path, mimeTypes.account),
  rows: { kind: 'computed', expr: postRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const publishedSum = key => `{{ (data.rows || []).filter(r => r.status === 'published').reduce((sum, r) => sum + r.${key}, 0) }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const postColumns = [['code', 'Post'], ['handle', 'Account'], ['excerpt', 'Content'],
  ['scheduledDate', 'Scheduled'], ['publishedAt', 'Published at']]

const containerNotices = () => [
  status('posts', `The ${containers.posts.path} folder could not be read. Reinstall Social Marketing to recreate it.`)[0],
  status('accounts', `The ${containers.accounts.path} folder could not be read. Reinstall Social Marketing to recreate it.`)[0],
]

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'social-marketing-home', name: 'Social Marketing', description: 'Social Marketing overview.', icon: 'megaphone' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count posts and engagement and show the social accounts and posts'),
        data: postSources,
        tree: page([
          row([
            column([heading('Social Marketing'), text('Social accounts and posts are files in your workspace. Draft posts in /social-posts, then schedule, publish or cancel them from their forms. Delivery to the networks is a platform integration.', 'muted')]),
            row([
              button('Upcoming posts', [openFile(`${installRoot}/canvas/upcoming.page.yaml`)], undefined, 'outline', 'calendar-clock'),
              button('Engagement', [openFile(`${installRoot}/canvas/engagement.page.yaml`)], undefined, 'outline', 'heart'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Published posts', countOf("r.status === 'published'"), 'megaphone', loading('posts')),
            stat('Scheduled', countOf("r.status === 'scheduled'"), 'calendar-clock', loading('posts')),
            stat('Drafts', countOf("r.status === 'draft'"), 'pencil', loading('posts')),
            stat('Total likes', publishedSum('likes'), 'heart', loading('posts')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'posts', label: 'Posts', icon: 'megaphone' },
            { value: 'accounts', label: 'Social accounts', icon: 'at-sign' },
          ], [
            panel('posts', [row([button('Open /social-posts', [openFile(containers.posts.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.posts.path, mimeTypes.post, [{ key: 'name', label: 'Post' }, { key: 'data.status', label: 'Status' },
                { key: 'data.scheduledDate', label: 'Scheduled' }, { key: 'data.publishedAt', label: 'Published at' }],
              `No posts yet. Use New in ${containers.posts.path}.`)]),
            panel('accounts', [row([button('Open /social-accounts', [openFile(containers.accounts.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.accounts.path, mimeTypes.account, [{ key: 'name', label: 'Account' }, { key: 'data.handle', label: 'Handle' },
                { key: 'data.network', label: 'Network' }], `No social accounts yet. Use New in ${containers.accounts.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function upcomingPage() {
  const upcoming = "{{ (data.rows || []).filter(r => r.status === 'scheduled').sort((a, b) => a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0) }}"
  return {
    file: 'upcoming.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'social-marketing-upcoming', name: 'Upcoming posts', description: 'Scheduled posts in calendar order.', icon: 'calendar-clock' },
      spec: {
        access: pageAccess('List scheduled posts in calendar order with their account handles'),
        data: postSources,
        tree: page([
          row([
            column([heading('Upcoming posts'), text('Every scheduled post, earliest first. Click a row to open the post.', 'muted')]),
            button('Social Marketing', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'megaphone'),
          ], 'between'),
          ...containerNotices(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'megaphone', loading('posts'))), 4),
          card('Calendar', [table(upcoming, [['scheduledDate', 'Date'], ...postColumns.slice(0, 3)], 'Nothing scheduled', true)]),
          tabs(statuses.map(value => ({ value, label: statusLabel(value), icon: 'megaphone' })),
            statuses.map(value => panel(value, [table(`{{ (data.rows || []).filter(r => r.status === '${value}') }}`,
              postColumns, `No ${statusLabel(value).toLowerCase()} posts`, true)]))),
        ]),
      },
    },
  }
}

function engagementPage() {
  const perAccount = "(data.rows || []).filter(r => r.accountPath === a.path && r.status === 'published')"
  const networkName = `({ ${Object.entries(networkLabels).map(([value, label]) => `'${value}': '${label}'`).join(', ')} })[a.data.network] || a.data.network || ''`
  const accountRows = `{{ (data.accounts || []).filter(a => a.kind === 'file' && a.data && a.data.state !== 'archived').map(a => ({ path: a.path, code: a.data.code || a.name, handle: a.data.handle || '', network: ${networkName}, active: a.data.active === true ? 'Yes' : 'No', published: ${perAccount}.length, likes: ${perAccount}.reduce((sum, r) => sum + r.likes, 0), shares: ${perAccount}.reduce((sum, r) => sum + r.shares, 0), comments: ${perAccount}.reduce((sum, r) => sum + r.comments, 0) })) }}`
  return {
    file: 'engagement.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'social-marketing-engagement', name: 'Engagement', description: 'Hand-recorded engagement, summed per social account.', icon: 'heart' },
      spec: {
        access: pageAccess('Sum published posts and engagement per social account'),
        data: postSources,
        tree: page([
          row([
            column([heading('Engagement by account'), text('Published posts and their hand-recorded likes, shares and comments, summed per social account.', 'muted')]),
            button('Social Marketing', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'megaphone'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Published posts', countOf("r.status === 'published'"), 'megaphone', loading('posts')),
            stat('Likes', publishedSum('likes'), 'heart', loading('posts')),
            stat('Shares', publishedSum('shares'), 'repeat', loading('posts')),
            stat('Comments', publishedSum('comments'), 'message-circle', loading('posts')),
          ]),
          card('Accounts', [table(accountRows, [['code', 'Account'], ['handle', 'Handle'], ['network', 'Network'], ['active', 'Active'],
            ['published', 'Published', 'end'], ['likes', 'Likes', 'end'], ['shares', 'Shares', 'end'], ['comments', 'Comments', 'end']],
          'No social accounts yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), upcomingPage(), engagementPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
