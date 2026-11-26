// Generates the Documents Canvas documents: a bound form per record kind, the settings form, the launch page,
// the inbox list, the per-workspace browser grouped by tags and the validated/archived library. The review
// workflow (status transitions, validation stamp, locking) is done by the action script the document form runs.
// Document cards only reference VFS paths — no page or form ever reads or writes the referenced files.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, statusLabels, statuses } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['validated'], warning: ['in-review'], danger: ['archived-status'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Documents schemas and run the document workflow script' }
export const lockedStatuses = ['validated', 'archived-status']
const locked = `${JSON.stringify(lockedStatuses)}.includes(form.values.status)`
const idle = 'form.saving || form.dirty'
const inInbox = "form.values.status === 'inbox'"
const inReview = "form.values.status === 'in-review'"
const isValidated = "form.values.status === 'validated'"

const workspaceSources = {
  workspaces: folder(containers.workspaces.path, mimeTypes.workspace),
  workspaceoptions: { kind: 'computed', expr: options('workspaces', "e.data.name || ''") },
}
const workspacesAccess = reason => ({ path: containers.workspaces.path, reason })

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind !== 'document') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [workspacesAccess('Choose the workspace a document card belongs to'), schemaAccess],
    data: workspaceSources,
    notices: [
      { ...text('Returned from review: {{ form.values.reviewComment }}', 'warning'),
        rules: { visible: `${inInbox} && !!String(form.values.reviewComment || '').trim()` } },
      { ...text('This document is validated and locked. Archive retires it.', 'success'), rules: { visible: isValidated } },
      { ...text('This document is archived and can no longer be edited.', 'muted'),
        rules: { visible: "form.values.status === 'archived-status'" } },
    ],
    buttons: [
      // The file opens beside its card in whichever app views it (an image or PDF viewer); Documents never reads it.
      button('Open file beside', [openFile('{{ form.values.filePath }}', undefined, 'side')], { visible: '!!(form.values.filePath)' }, 'outline', 'panel-right-open'),
      button('Send to review', 'send-to-review', { visible: `${inInbox} && !(${archived})`, disabled: idle }, undefined, 'send'),
      button('Validate', 'validate', { visible: `${inReview} && !(${archived})`, disabled: idle }, undefined, 'check'),
      button('Return to inbox', 'return-to-inbox', { visible: `${inReview} && !(${archived})`,
        disabled: `${idle} || !String(form.values.reviewComment || '').trim()` }, 'outline', 'undo-2'),
      button('Archive document', 'archive-document', { visible: `${isValidated} && !(${archived})`, disabled: idle }, 'outline', 'archive'),
    ],
    actions: {
      'send-to-review': scriptAction(postScriptPath, 'send-to-review', {
        confirm: { title: 'Send to review', message: 'Send this document to review? Validate or return it from there.' },
      }),
      validate: scriptAction(postScriptPath, 'validate', {
        confirm: { title: 'Validate document', message: 'Validate this document? Validated documents are stamped and locked; they can only be archived.' },
      }),
      'return-to-inbox': scriptAction(postScriptPath, 'return-to-inbox', {
        confirm: { title: 'Return to inbox', message: 'Return this document to the inbox with its review comment?' },
      }),
      'archive-document': scriptAction(postScriptPath, 'archive', {
        confirm: { title: 'Archive document', message: 'Archive this validated document? Archived documents stay locked.' },
      }),
    },
    locked,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(`{{ ${JSON.stringify(statusLabels)}[form.values.${entity.status}] || '' }}`,
          toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...extras.buttons, recordButtons(extras.locked)],
  )
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    archivedAlert(entity.singular),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `documents-${kind}`, displayName: `Documents ${entity.singular.toLowerCase()}`,
      description: `View and edit a Documents ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'documents-settings', displayName: 'Documents settings', description: 'Edit the Documents settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [workspacesAccess('Choose the default workspace for new document cards'), schemaAccess],
      data: workspaceSources,
      tree: [
        pageHeader(
          [heading('Documents settings'), text('The default workspace for new document cards. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('workspaces', `The ${containers.workspaces.path} folder could not be read. Reinstall Documents to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active document card flattened for the pages: status, workspace path and name, tags and file reference.
const cardRows = `(data.cards || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', filePath: e.data.filePath || '', workspacePath: e.data.workspace || '', workspace: ((((data.workspaces || []).find(w => w.kind === 'file' && w.data && w.path === e.data.workspace) || {}).data || {}).name) || '', tagList: e.data.tags || [], tags: (e.data.tags || []).join(', '), owner: e.data.owner || '', status: e.data.status || '', validatedAt: e.data.validatedAt || '' }))`
const cardSources = {
  cards: folder(containers.cards.path, mimeTypes.document),
  workspaces: folder(containers.workspaces.path, mimeTypes.workspace),
  rows: { kind: 'computed', expr: cardRows },
}
const pageAccess = reason => [containers.cards, containers.workspaces].map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const cardColumns = [['code', 'Document'], ['title', 'Title'], ['workspace', 'Workspace'], ['tags', 'Tags'], ['owner', 'Owner'], ['filePath', 'File']]

const containerNotices = (names = ['cards', 'workspaces']) => names.map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Documents to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'documents-home', name: 'Documents', description: 'Documents overview.', icon: 'folder-kanban' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [...pageAccess('Count document cards and show the workspaces and cards'),
          { path: containers.tags.path, reason: 'Show the curated tag set' }],
        data: { ...cardSources, tags: folder(containers.tags.path, mimeTypes.tag) },
        tree: page([
          pageHeader(
            [heading('Documents'), text('A tagging and review workflow over files already in your workspace. Cards in /document-cards reference VFS paths; the files themselves stay where they are.', 'muted')], [
            row([
              button('Inbox', [openFile(`${installRoot}/canvas/inbox.page.yaml`)], undefined, 'outline', 'inbox'),
              button('Workspaces', [openFile(`${installRoot}/canvas/workspaces.page.yaml`)], undefined, 'outline', 'folder-kanban'),
              button('Library', [openFile(`${installRoot}/canvas/library.page.yaml`)], undefined, 'outline', 'library'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats(statuses.map(value => stat(statusLabels[value], countOf(`r.status === '${value}'`), 'file-text', loading('cards')))),
          ...containerNotices(['cards', 'workspaces', 'tags']),
          tabs([
            { value: 'cards', label: 'Documents', icon: 'file-text' },
            { value: 'workspaces', label: 'Workspaces', icon: 'folder-kanban' },
            { value: 'tags', label: 'Tags', icon: 'tag' },
          ], [
            panel('cards', [row([button('Open /document-cards', [openFile(containers.cards.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.cards.path, mimeTypes.document, [{ key: 'name', label: 'Document' }, { key: 'data.title', label: 'Title' },
                { key: 'data.status', label: 'Status' }, { key: 'data.owner', label: 'Owner' },
                { key: 'data.filePath', label: 'File' }], `No document cards yet. Use New in ${containers.cards.path}.`)]),
            panel('workspaces', [row([button('Open /document-workspaces', [openFile(containers.workspaces.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.workspaces.path, mimeTypes.workspace, [{ key: 'name', label: 'Workspace' }, { key: 'data.name', label: 'Name' },
                { key: 'data.description', label: 'Description' }], `No workspaces yet. Use New in ${containers.workspaces.path}.`)]),
            panel('tags', [row([button('Open /document-tags', [openFile(containers.tags.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.tags.path, mimeTypes.tag, [{ key: 'name', label: 'Tag' }, { key: 'data.label', label: 'Label' },
                { key: 'data.category', label: 'Category' }], `No tags yet. Use New in ${containers.tags.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function inboxPage() {
  const inboxRows = `{{ (data.rows || []).filter(r => r.status === 'inbox').sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)) }}`
  return {
    file: 'inbox.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'documents-inbox', name: 'Inbox', description: 'Document cards waiting to be filed and sent to review.', icon: 'inbox' },
      spec: {
        access: pageAccess('List inbox document cards with their workspace names'),
        data: cardSources,
        tree: page([
          pageHeader(
            [heading('Inbox'), text('New document cards land here. File them into a workspace, tag them and send them to review from their form.', 'muted')], [
            button('Documents', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'folder-kanban'),
          ]),
          ...containerNotices(),
          stats([
            stat('In the inbox', countOf("r.status === 'inbox'"), 'inbox', loading('cards')),
            stat('Without a file', countOf("r.status === 'inbox' && !r.filePath"), 'file-x', loading('cards')),
            stat('Untagged', countOf("r.status === 'inbox' && r.tagList.length === 0"), 'tag', loading('cards')),
            stat('Unowned', countOf("r.status === 'inbox' && !r.owner"), 'user-x', loading('cards')),
          ]),
          table(inboxRows, cardColumns, 'The inbox is empty', true),
        ]),
      },
    },
  }
}

function workspacesPage() {
  const workspaceRows = `{{ (data.workspaces || []).filter(w => w.kind === 'file' && w.data && w.data.state !== 'archived').map(w => ({ path: w.path, code: w.data.code || w.name, name: w.data.name || '', defaultTags: (w.data.defaultTags || []).join(', '), documents: (data.rows || []).filter(r => r.workspacePath === w.path).length, inbox: (data.rows || []).filter(r => r.workspacePath === w.path && r.status === 'inbox').length, inReview: (data.rows || []).filter(r => r.workspacePath === w.path && r.status === 'in-review').length, validated: (data.rows || []).filter(r => r.workspacePath === w.path && r.status === 'validated').length })) }}`
  const pairs = `(data.rows || []).map(r => (r.tagList.length ? r.tagList : ['untagged']).map(t => ({ group: (r.workspace || 'No workspace') + ' / ' + t }))).reduce((a, b) => a.concat(b), [])`
  const tagGroupRows = `{{ ${pairs}.map(p => p.group).filter((v, i, a) => a.indexOf(v) === i).sort().map(g => ({ group: g, documents: ${pairs}.filter(p => p.group === g).length })) }}`
  const groupedRows = `{{ (data.rows || []).map(r => ({ workspace: r.workspace || 'No workspace', tags: r.tags || 'untagged', path: r.path, code: r.code, title: r.title, status: r.status, filePath: r.filePath })).sort((a, b) => (a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : a.tags < b.tags ? -1 : a.tags > b.tags ? 1 : a.code < b.code ? -1 : 1)) }}`
  return {
    file: 'workspaces.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'documents-workspaces', name: 'Workspaces', description: 'Document cards per workspace, grouped by tags.', icon: 'folder-kanban' },
      spec: {
        access: pageAccess('Browse document cards per workspace, grouped by their tags'),
        data: cardSources,
        tree: page([
          pageHeader(
            [heading('Workspace browser'), text('Every workspace with its document cards, grouped by tags. Click a workspace to open it.', 'muted')], [
            button('Documents', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'folder-kanban'),
          ]),
          ...containerNotices(),
          card('Workspaces', [table(workspaceRows, [['code', 'Workspace'], ['name', 'Name'], ['defaultTags', 'Default tags'],
            ['documents', 'Documents', 'end'], ['inbox', 'Inbox', 'end'], ['inReview', 'In review', 'end'], ['validated', 'Validated', 'end']],
            'No workspaces yet', true)]),
          card('Tag groups', [table(tagGroupRows, [['group', 'Workspace / tag'], ['documents', 'Documents', 'end']], 'No document cards yet')]),
          card('Documents by workspace and tags', [table(groupedRows, [['workspace', 'Workspace'], ['tags', 'Tags'], ['code', 'Document'],
            ['title', 'Title'], ['status', 'Status'], ['filePath', 'File']], 'No document cards yet', true)]),
        ]),
      },
    },
  }
}

function libraryPage() {
  const rowsOf = value => `{{ (data.rows || []).filter(r => r.status === '${value}').sort((a, b) => ((a.validatedAt || '') < (b.validatedAt || '') ? 1 : -1)) }}`
  const libraryColumns = [...cardColumns, ['validatedAt', 'Validated at']]
  return {
    file: 'library.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'documents-library', name: 'Library', description: 'Validated and archived document cards.', icon: 'library' },
      spec: {
        access: pageAccess('List validated and archived document cards'),
        data: cardSources,
        tree: page([
          pageHeader(
            [heading('Library'), text('Validated documents are stamped and locked; archived documents are retired. Both keep referencing their files in the VFS.', 'muted')], [
            button('Documents', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'folder-kanban'),
          ]),
          ...containerNotices(),
          stats([
            stat('Validated', countOf("r.status === 'validated'"), 'check', loading('cards')),
            stat('Archived', countOf("r.status === 'archived-status'"), 'archive', loading('cards')),
            stat('In review', countOf("r.status === 'in-review'"), 'hourglass', loading('cards')),
            stat('In the inbox', countOf("r.status === 'inbox'"), 'inbox', loading('cards')),
          ]),
          tabs([
            { value: 'validated', label: 'Validated', icon: 'check' },
            { value: 'archived', label: 'Archived', icon: 'archive' },
          ], [
            panel('validated', [table(rowsOf('validated'), libraryColumns, 'No validated documents yet', true)]),
            panel('archived', [table(rowsOf('archived-status'), libraryColumns, 'No archived documents yet', true)]),
          ]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), inboxPage(), workspacesPage(), libraryPage(), ...recordKinds.map(recordForm), settingsForm(), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
