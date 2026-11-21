// Generates the Discuss Canvas documents: a bound form per record kind (the thread form shows the message
// trail and composes new messages), the settings form, the launch page, the channels list and the threads
// activity list. Posting, resolving, locking, reopening and archiving are done by the action script the
// forms run — Discuss is the durable discussion record, not a realtime transport.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, threadStatuses } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['resolved', 'active'], warning: ['archived'], danger: ['locked'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Discuss schemas and run the discussion action script' }
const idle = 'form.saving || form.dirty'
const openThread = "form.values.status === 'open'"
const resolvedThread = "form.values.status === 'resolved'"
const lockedThread = "form.values.status === 'locked'"
const archivedChannel = "form.values.status === 'archived'"

const channelSources = {
  channels: folder(containers.channels.path, mimeTypes.channel),
  channeloptions: { kind: 'computed', expr: options('channels', "e.data.name || ''", "e.data.status !== 'archived'") },
}
const channelsAccess = reason => ({ path: containers.channels.path, reason })

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'channel') {
    return {
      access: [schemaAccess],
      data: {},
      notices: [
        { ...text('This channel is archived: its threads no longer accept messages.', 'muted'), rules: { visible: archivedChannel } },
      ],
      buttons: [
        button('Archive channel', 'archive-channel', { visible: `!(${archivedChannel}) && !(${archived})`, disabled: idle }, 'outline', 'archive'),
      ],
      actions: {
        'archive-channel': scriptAction(postScriptPath, 'archive-channel', {
          confirm: { title: 'Archive channel', message: 'Archive this channel? Its threads stop accepting messages. Archiving cannot be undone.' },
        }),
      },
      locked: archivedChannel,
    }
  }
  return {
    access: [channelsAccess('Choose the channel a thread belongs to'), schemaAccess],
    data: channelSources,
    notices: [
      { ...text('This thread is resolved. Reopen it to post again.', 'muted'), rules: { visible: resolvedThread } },
      { ...text('This thread is locked and can no longer be edited.', 'muted'), rules: { visible: lockedThread } },
    ],
    buttons: [
      button('Post message', 'post-message', { visible: `${openThread} && !(${archived})`,
        disabled: `${idle} || !String(form.values.draft || '').trim()` }, undefined, 'send'),
      button('Resolve', 'resolve-thread', { visible: `${openThread} && !(${archived})`, disabled: idle }, 'outline', 'check'),
      button('Reopen', 'reopen-thread', { visible: `${resolvedThread} && !(${archived})`, disabled: idle }, 'outline', 'rotate-ccw'),
      button('Lock', 'lock-thread', { visible: `${resolvedThread} && !(${archived})`, disabled: idle }, 'outline', 'lock'),
    ],
    actions: {
      // The idempotency key is evaluated once per click; a retried run reuses it, so the trail never
      // gets the same message twice.
      'post-message': scriptAction(postScriptPath, 'post-message', {
        parameters: { body: '{{ form.values.draft }}', author: '{{ form.values.postAs }}', key: '{{ Date() }}' },
      }),
      'resolve-thread': scriptAction(postScriptPath, 'resolve-thread', {
        confirm: { title: 'Resolve thread', message: 'Mark this thread resolved? Resolved threads can be reopened or locked.' },
      }),
      'lock-thread': scriptAction(postScriptPath, 'lock-thread', {
        confirm: { title: 'Lock thread', message: 'Lock this resolved thread? Locked threads are read-only and cannot be reopened.' },
      }),
      'reopen-thread': scriptAction(postScriptPath, 'reopen-thread', {
        confirm: { title: 'Reopen thread', message: 'Reopen this resolved thread so it accepts messages again?' },
      }),
    },
    locked: lockedThread,
  }
}

/** The thread's message trail: the ordered, auditable record the thread view shows. */
const trailCard = card('Messages', [
  table('{{ form.values.messages || [] }}', [['sequence', '#'], ['author', 'Author'], ['date', 'Date'], ['body', 'Message']],
    'No messages yet. Compose one below and Post message.'),
], 'The durable trail. Messages are appended by the Post message action and never silently rewritten.')

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
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
    ...(kind === 'thread' ? [trailCard] : []),
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `discuss-${kind}`, displayName: `Discuss ${entity.singular.toLowerCase()}`,
      description: `View and edit a Discuss ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'discuss-settings', displayName: 'Discuss settings', description: 'Edit the Discuss settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [channelsAccess('Choose the default channel for new threads'), schemaAccess],
      data: channelSources,
      tree: [
        row([
          column([heading('Discuss settings'), text('The default channel for new threads. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        ...status('channels', `The ${containers.channels.path} folder could not be read. Reinstall Discuss to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active thread flattened for the pages: channel path and name, status, message count, last activity.
const threadRows = `(data.threads || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, subject: e.data.subject || '', channelPath: e.data.channel || '', channel: ((((data.channels || []).find(c => c.kind === 'file' && c.data && c.path === e.data.channel) || {}).data || {}).name) || '', status: e.data.status || '', startedBy: e.data.startedBy || '', messages: (e.data.messages || []).length, lastActivityAt: e.data.lastActivityAt || '' }))`
const threadSources = {
  threads: folder(containers.threads.path, mimeTypes.thread),
  channels: folder(containers.channels.path, mimeTypes.channel),
  rows: { kind: 'computed', expr: threadRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value[0].toUpperCase() + value.slice(1)
const byActivity = rows => `${rows}.sort((a, b) => ((a.lastActivityAt || '') < (b.lastActivityAt || '') ? 1 : (a.lastActivityAt || '') > (b.lastActivityAt || '') ? -1 : 0))`
const threadColumns = [['code', 'Thread'], ['subject', 'Subject'], ['channel', 'Channel'], ['status', 'Status'],
  ['messages', 'Messages', 'end'], ['lastActivityAt', 'Last activity']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Discuss to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'discuss-home', name: 'Discuss', description: 'Discuss overview.', icon: 'messages-square' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count threads and show the channels and threads'),
        data: threadSources,
        tree: page([
          row([
            column([heading('Discuss'), text('Channels and threads are files in your workspace: the durable, auditable discussion record. Realtime delivery and notifications are the platform\'s concern, not this app\'s.', 'muted')]),
            row([
              button('Channels', [openFile(`${installRoot}/canvas/channels.page.yaml`)], undefined, 'outline', 'hash'),
              button('Threads', [openFile(`${installRoot}/canvas/threads.page.yaml`)], undefined, 'outline', 'messages-square'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Open threads', countOf("r.status === 'open'"), 'messages-square', loading('threads')),
            stat('Resolved', countOf("r.status === 'resolved'"), 'check', loading('threads')),
            stat('Locked', countOf("r.status === 'locked'"), 'lock', loading('threads')),
            stat('Messages', `{{ (data.rows || []).reduce((sum, r) => sum + r.messages, 0) }}`, 'mail', loading('threads')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'threads', label: 'Threads', icon: 'messages-square' },
            { value: 'channels', label: 'Channels', icon: 'hash' },
          ], [
            panel('threads', [row([button('Open /threads', [openFile(containers.threads.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.threads.path, mimeTypes.thread, [{ key: 'name', label: 'Thread' }, { key: 'data.subject', label: 'Subject' },
                { key: 'data.status', label: 'Status' }, { key: 'data.lastActivityAt', label: 'Last activity' }], `No threads yet. Use New in ${containers.threads.path}.`)]),
            panel('channels', [row([button('Open /channels', [openFile(containers.channels.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.channels.path, mimeTypes.channel, [{ key: 'name', label: 'Channel' }, { key: 'data.name', label: 'Name' },
                { key: 'data.visibility', label: 'Kind' }, { key: 'data.status', label: 'Status' }], `No channels yet. Use New in ${containers.channels.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function channelsPage() {
  const channelRows = `{{ (data.channels || []).filter(e => ${active}).map(c => ({ path: c.path, code: c.data.code || c.name, name: c.data.name || '', visibility: c.data.visibility || '', topic: c.data.topic || '', members: (c.data.members || []).length, status: c.data.status || '', open: (data.rows || []).filter(r => r.channelPath === c.path && r.status === 'open').length, lastActivityAt: (data.rows || []).filter(r => r.channelPath === c.path).map(r => r.lastActivityAt).sort().reverse()[0] || '' })) }}`
  return {
    file: 'channels.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'discuss-channels', name: 'Channels', description: 'Every discussion channel with its open threads and last activity.', icon: 'hash' },
      spec: {
        access: pageAccess('List channels with their open threads and last activity'),
        data: threadSources,
        tree: page([
          row([
            column([heading('Channels'), text('Every active channel. Click a row to open the channel; its threads live in /threads and reference it.', 'muted')]),
            button('Discuss', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'messages-square'),
          ], 'between'),
          ...containerNotices(),
          table(channelRows, [['code', 'Channel'], ['name', 'Name'], ['visibility', 'Kind'], ['topic', 'Topic'],
            ['members', 'Members', 'end'], ['open', 'Open threads', 'end'], ['status', 'Status'], ['lastActivityAt', 'Last activity']],
            'No channels yet', true),
        ]),
      },
    },
  }
}

function threadsPage() {
  const rows = status => `{{ ${byActivity(`(data.rows || []).filter(r => r.status === '${status}')`)} }}`
  return {
    file: 'threads.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'discuss-threads', name: 'Threads', description: 'Every thread by last activity, grouped by status.', icon: 'messages-square' },
      spec: {
        access: pageAccess('List threads by last activity with their channel names'),
        data: threadSources,
        tree: page([
          row([
            column([heading('Threads by activity'), text('Every active thread, most recent activity first. Click a row to open the thread and its message trail.', 'muted')]),
            button('Discuss', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'messages-square'),
          ], 'between'),
          ...containerNotices(),
          stats(threadStatuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'messages-square', loading('threads'))), 3),
          tabs(threadStatuses.map(value => ({ value, label: statusLabel(value), icon: 'messages-square' })),
            threadStatuses.map(value => panel(value, [table(rows(value), threadColumns, `No ${value} threads`, true)]))),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), channelsPage(), threadsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
