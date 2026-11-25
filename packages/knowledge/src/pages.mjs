// Generates the Knowledge Canvas documents: a bound form per record kind, the settings form, the launch page,
// the space browser (articles grouped by space, hierarchy via the parent reference), the recently-updated list
// and the tag summary. Publishing, archiving and restoring (status transitions, locking) are done by the action
// script the article form runs.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['published'], warning: ['archived'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Knowledge schemas and run the article action script' }
const archivedStatus = "form.values.status === 'archived'"
const idle = 'form.saving || form.dirty'
const filled = key => `!!String(form.values.${key} || '').trim()`

const spaceSources = {
  spaces: folder(containers.spaces.path, mimeTypes.space),
  spaceoptions: { kind: 'computed', expr: options('spaces', "e.data.name || ''") },
}
const spacesAccess = reason => ({ path: containers.spaces.path, reason })
const articlesAccess = reason => ({ path: containers.articles.path, reason })

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'space') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [
      spacesAccess('Choose the space an article belongs to'),
      articlesAccess('Choose the parent article an article nests beneath'),
      schemaAccess,
    ],
    data: {
      ...spaceSources,
      articles: folder(containers.articles.path, mimeTypes.article),
      parentoptions: { kind: 'computed', expr: options('articles', "e.data.title || ''") },
    },
    notices: [
      { ...text('This article is archived and can no longer be edited. Restore it to draft to change it.', 'muted'),
        rules: { visible: archivedStatus } },
    ],
    buttons: [
      button('Publish', 'publish', { visible: `form.values.status === 'draft' && !(${archived})`,
        disabled: `${idle} || !(${filled('title')}) || !(${filled('body')})` }, undefined, 'send'),
      button('Archive article', 'archive-article', { visible: `form.values.status === 'published' && !(${archived})`, disabled: idle }, 'outline', 'archive'),
      button('Restore draft', 'restore-draft', { visible: `${archivedStatus} && !(${archived})`, disabled: idle }, 'outline', 'undo'),
    ],
    actions: {
      publish: scriptAction(postScriptPath, 'publish', {
        confirm: { title: 'Publish article', message: 'Publish this article? Published articles appear in every listing and can be archived later.' },
      }),
      'archive-article': scriptAction(postScriptPath, 'archive', {
        confirm: { title: 'Archive article', message: 'Archive this published article? Archived articles are locked until restored to draft.' },
      }),
      'restore-draft': scriptAction(postScriptPath, 'restore', {
        confirm: { title: 'Restore to draft', message: 'Restore this archived article to draft so it can be edited and published again?' },
      }),
    },
    locked: archivedStatus,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
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
      name: `knowledge-${kind}`, displayName: `Knowledge ${entity.singular.toLowerCase()}`,
      description: `View and edit a Knowledge ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'knowledge-settings', displayName: 'Knowledge settings', description: 'Edit the Knowledge settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [spacesAccess('Choose the default space for new articles'), schemaAccess],
      data: spaceSources,
      tree: [
        pageHeader(
          [heading('Knowledge settings'), text('The default space for new articles. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('spaces', `The ${containers.spaces.path} folder could not be read. Reinstall Knowledge to recreate it.`),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active article flattened for the pages: space path and name, parent code, status, tags and update stamp.
const articleRows = `(data.articles || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', spacePath: e.data.space || '', space: ((((data.spaces || []).find(s => s.kind === 'file' && s.data && s.path === e.data.space) || {}).data || {}).name) || '', parent: e.data.parent || '', parentCode: ((((data.articles || []).find(p => p.kind === 'file' && p.data && p.path === e.data.parent) || {}).data || {}).code) || '', status: e.data.status || '', tags: e.data.tags || [], tagList: (e.data.tags || []).join(', '), owner: e.data.owner || '', updatedAt: e.data.updatedAt || '' }))`
const articleSources = {
  articles: folder(containers.articles.path, mimeTypes.article),
  spaces: folder(containers.spaces.path, mimeTypes.space),
  rows: { kind: 'computed', expr: articleRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`

const containerNotices = () => Object.keys(containers).map(name =>
  status(name === 'spaces' ? 'spaces' : 'articles', `The ${containers[name].path} folder could not be read. Reinstall Knowledge to recreate it.`)[0])

const backButton = () => button('Knowledge', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'book-open')

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'knowledge-home', name: 'Knowledge', description: 'Knowledge overview.', icon: 'book-open' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count articles and show the spaces and articles'),
        data: articleSources,
        tree: page([
          pageHeader(
            [heading('Knowledge'), text('Spaces and Markdown articles are files in your workspace. Draft articles in /articles, nest them beneath a parent, then publish, archive and restore them from their forms.', 'muted')], [
            row([
              button('Spaces', [openFile(`${installRoot}/canvas/spaces.page.yaml`)], undefined, 'outline', 'library'),
              button('Recently updated', [openFile(`${installRoot}/canvas/recent.page.yaml`)], undefined, 'outline', 'clock'),
              button('Tags', [openFile(`${installRoot}/canvas/tags.page.yaml`)], undefined, 'outline', 'tags'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Articles', countOf('true'), 'file-text', loading('articles')),
            stat('Published', countOf("r.status === 'published'"), 'send', loading('articles')),
            stat('Drafts', countOf("r.status === 'draft'"), 'pencil', loading('articles')),
            stat('Spaces', `{{ (data.spaces || []).filter(e => ${active}).length }}`, 'library', loading('spaces')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'articles', label: 'Articles', icon: 'file-text' },
            { value: 'spaces', label: 'Spaces', icon: 'library' },
          ], [
            panel('articles', [row([button('Open /articles', [openFile(containers.articles.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.articles.path, mimeTypes.article, [{ key: 'name', label: 'Article' }, { key: 'data.title', label: 'Title' },
                { key: 'data.status', label: 'Status' }, { key: 'data.owner', label: 'Owner' },
                { key: 'data.updatedAt', label: 'Updated' }], `No articles yet. Use New in ${containers.articles.path}.`)]),
            panel('spaces', [row([button('Open /knowledge-spaces', [openFile(containers.spaces.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.spaces.path, mimeTypes.space, [{ key: 'name', label: 'Space' }, { key: 'data.name', label: 'Name' },
                { key: 'data.description', label: 'Description' }], `No spaces yet. Use New in ${containers.spaces.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function spacesPage() {
  const spaceRows = `{{ (data.spaces || []).filter(s => s.kind === 'file' && s.data && s.data.state !== 'archived').map(s => ({ path: s.path, space: s.data.name || s.name, icon: s.data.icon || '', description: s.data.description || '', articles: (data.rows || []).filter(r => r.spacePath === s.path).length, published: (data.rows || []).filter(r => r.spacePath === s.path && r.status === 'published').length, drafts: (data.rows || []).filter(r => r.spacePath === s.path && r.status === 'draft').length })) }}`
  // Articles sort beneath their space; a nested article sorts directly after its parent and is indented.
  const groupedRows = `{{ (data.rows || []).map(r => ({ path: r.path, space: r.space || 'No space', article: (r.parentCode ? '\u21b3 ' : '') + (r.title || r.code), code: r.code, parent: r.parentCode, status: r.status, updatedAt: r.updatedAt, sort: (r.space || '\u007e') + '|' + (r.parentCode ? r.parentCode + '|1|' : '') + r.code })).sort((a, b) => a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0) }}`
  return {
    file: 'spaces.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'knowledge-spaces', name: 'Spaces', description: 'Articles grouped by space, with their hierarchy.', icon: 'library' },
      spec: {
        access: pageAccess('Group articles by space with their parent hierarchy'),
        data: articleSources,
        tree: page([
          pageHeader(
            [heading('Spaces'), text('Every active article grouped by its space. Nested articles are indented beneath their parent. Click a row to open it.', 'muted')], [
            backButton(),
          ]),
          ...containerNotices(),
          card('Spaces', [table(spaceRows, [['space', 'Space'], ['icon', 'Icon'], ['description', 'Description'],
            ['articles', 'Articles', 'end'], ['published', 'Published', 'end'], ['drafts', 'Drafts', 'end']], 'No spaces yet', true)]),
          card('Articles by space', [table(groupedRows, [['space', 'Space'], ['article', 'Article'], ['code', 'Code'],
            ['parent', 'Parent'], ['status', 'Status'], ['updatedAt', 'Updated']], 'No articles yet', true)]),
        ]),
      },
    },
  }
}

function recentPage() {
  const recentRows = `{{ (data.rows || []).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0).slice(0, 50) }}`
  return {
    file: 'recent.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'knowledge-recent', name: 'Recently updated', description: 'The most recently updated articles.', icon: 'clock' },
      spec: {
        access: pageAccess('List articles by their last update'),
        data: articleSources,
        tree: page([
          pageHeader(
            [heading('Recently updated'), text('The 50 most recently updated active articles. Click a row to open the article.', 'muted')], [
            backButton(),
          ]),
          ...containerNotices(),
          table(recentRows, [['code', 'Article'], ['title', 'Title'], ['space', 'Space'], ['status', 'Status'],
            ['owner', 'Owner'], ['updatedAt', 'Updated']], 'No articles yet', true),
        ]),
      },
    },
  }
}

function tagsPage() {
  const tagRows = `{{ (data.rows || []).reduce((a, r) => a.concat(r.tags), []).filter((v, i, arr) => arr.indexOf(v) === i).sort().map(t => ({ tag: t, articles: (data.rows || []).filter(r => r.tags.indexOf(t) >= 0).length, published: (data.rows || []).filter(r => r.tags.indexOf(t) >= 0 && r.status === 'published').length, drafts: (data.rows || []).filter(r => r.tags.indexOf(t) >= 0 && r.status === 'draft').length, archived: (data.rows || []).filter(r => r.tags.indexOf(t) >= 0 && r.status === 'archived').length })) }}`
  const untagged = `{{ (data.rows || []).filter(r => r.tags.length === 0).length }}`
  return {
    file: 'tags.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'knowledge-tags', name: 'Tags', description: 'Articles summarised per tag.', icon: 'tags' },
      spec: {
        access: pageAccess('Sum articles per tag'),
        data: articleSources,
        tree: page([
          pageHeader(
            [heading('Tags'), text('Every tag across the active articles, with how many articles carry it by status.', 'muted')], [
            backButton(),
          ]),
          ...containerNotices(),
          stats([
            stat('Tags', `{{ (data.rows || []).reduce((a, r) => a.concat(r.tags), []).filter((v, i, arr) => arr.indexOf(v) === i).length }}`, 'tags', loading('articles')),
            stat('Tagged articles', countOf('r.tags.length > 0'), 'file-text', loading('articles')),
            stat('Untagged articles', untagged, 'file-question', loading('articles')),
            stat('Published', countOf("r.status === 'published'"), 'send', loading('articles')),
          ]),
          card('Articles per tag', [table(tagRows, [['tag', 'Tag'], ['articles', 'Articles', 'end'],
            ['published', 'Published', 'end'], ['drafts', 'Drafts', 'end'], ['archived', 'Archived', 'end']], 'No tags yet')]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), spacesPage(), recentPage(), tagsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
