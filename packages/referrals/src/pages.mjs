// Generates the Referrals Canvas documents: the bound referral form, the settings form, the launch page, the
// referrals list by status and the points leaderboard. Deciding referrals (status transitions, awarding points
// from the settings, locking) is done by the action script the referral form runs.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, employees, installRoot, mimeTypes, recordKinds, recruitment, schemaId, settingsPath, statuses } from './contracts.mjs'
import { referrer, entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['hired'], warning: ['in-process'], danger: ['not-hired'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Referrals schemas and run the referral action script' }
const decided = "['hired','not-hired'].includes(form.values.status)"
const idle = 'form.saving || form.dirty'


/** Data, access, actions, header buttons and notices of the referral form. */
function recordExtras() {
  return {
    access: [
      { path: recruitment.jobs, reason: 'Offer Recruitment job positions on referrals (when Recruitment is installed)' },
      ...referrer.sources.access,
      schemaAccess,
    ],
    data: {
      jobrecords: folder(recruitment.jobs, recruitment.jobMime),
      joboptions: { kind: 'computed', expr: options('jobrecords', 'e.data.title || e.data.code || e.name') },
      ...referrer.sources.data,
    },
    notices: [
      { ...text('Hired on {{ form.values.decidedAt }}: {{ form.values.points }} points awarded. This referral is locked.', 'success'),
        rules: { visible: "form.values.status === 'hired'" } },
      { ...text('Decided on {{ form.values.decidedAt }}: not hired. This referral is locked.', 'muted'),
        rules: { visible: "form.values.status === 'not-hired'" } },
    ],
    buttons: [
      button('Mark hired', 'mark-hired', { visible: `!(${decided}) && !(${archived})`, disabled: idle }, undefined, 'check'),
      button('Mark not hired', 'mark-not-hired', { visible: `!(${decided}) && !(${archived})`, disabled: idle }, 'outline', 'x'),
      { ...referrer.meButton, rules: { ...referrer.meButton.rules, visible: `!(${decided}) && !(${archived}) && ${referrer.meButton.rules.visible}` } },
    ],
    actions: {
      ...referrer.meAction,
      'mark-hired': scriptAction(postScriptPath, 'mark-hired', {
        confirm: { title: 'Mark hired', message: 'Mark this referral hired and award the points from the Referrals settings? Decided referrals are locked.' },
      }),
      'mark-not-hired': scriptAction(postScriptPath, 'mark-not-hired', {
        confirm: { title: 'Mark not hired', message: 'Mark this referral not hired? Decided referrals are locked.' },
      }),
    },
    locked: decided,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras()
  const readOnly = `${archived} || (${extras.locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
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
      name: `referrals-${kind}`, displayName: `Referrals ${entity.singular.toLowerCase()}`,
      description: `View and edit a ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'referrals-settings', displayName: 'Referrals settings', description: 'Edit the Referrals settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        pageHeader(
          [heading('Referrals settings'), text('The points Mark hired awards. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        grid([card('Points', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active referral flattened for the pages: referrer, candidate, status and points.
const referralRows = `(data.referrals || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, referrer: e.data.referrerName || '', candidate: e.data.candidateName || '', status: e.data.status || '', points: Number(e.data.points) || 0, decidedAt: e.data.decidedAt || '' }))`
const referralSources = {
  referrals: folder(containers.referrals.path, mimeTypes.referral),
  rows: { kind: 'computed', expr: referralRows },
}
const pageAccess = reason => [{ path: containers.referrals.path, reason }]
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const referralColumns = [['code', 'Referral'], ['referrer', 'Referrer'], ['candidate', 'Candidate'], ['decidedAt', 'Decided'], ['points', 'Points', 'end']]

const containerNotice = () => status('referrals', `The ${containers.referrals.path} folder could not be read. Reinstall Referrals to recreate it.`)[0]

const hiredRows = `(data.rows || []).filter(r => r.status === 'hired')`
const totalPoints = `{{ (data.rows || []).map(r => r.points).reduce((sum, v) => sum + v, 0) }}`

// The leaderboard groups active referrals per referrer: referrals, hires and total points, most points first.
const referrers = `(data.rows || []).map(r => r.referrer || 'No referrer').filter((v, i, a) => a.indexOf(v) === i)`
const perReferrer = `${referrers}.map(name => ({ referrer: name, referrals: (data.rows || []).filter(r => (r.referrer || 'No referrer') === name).length, hired: ${hiredRows}.filter(r => (r.referrer || 'No referrer') === name).length, points: (data.rows || []).filter(r => (r.referrer || 'No referrer') === name).map(r => r.points).reduce((sum, v) => sum + v, 0) })).sort((a, b) => b.points - a.points || a.referrer.localeCompare(b.referrer))`

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'referrals-home', name: 'Referrals', description: 'Referrals overview.', icon: 'gift' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count referrals and show them'),
        data: referralSources,
        tree: page([
          pageHeader(
            [heading('Referrals'), text('Employee referrals are files in your workspace. Submit them in /referrals, track them, then decide them from their forms. Hires award points from the settings.', 'muted')], [
            row([
              button('By status', [openFile(`${installRoot}/canvas/referrals.page.yaml`)], undefined, 'outline', 'list'),
              button('Leaderboard', [openFile(`${installRoot}/canvas/leaderboard.page.yaml`)], undefined, 'outline', 'trophy'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Open', countOf("['submitted','in-process'].includes(r.status)"), 'hourglass', loading('referrals')),
            stat('Hired', countOf("r.status === 'hired'"), 'check', loading('referrals')),
            stat('Not hired', countOf("r.status === 'not-hired'"), 'x', loading('referrals')),
            stat('Points awarded', totalPoints, 'trophy', loading('referrals')),
          ]),
          containerNotice(),
          row([button('Open /referrals', [openFile(containers.referrals.path)], undefined, 'outline', 'folder-open')]),
          browser(containers.referrals.path, mimeTypes.referral, [{ key: 'name', label: 'Referral' }, { key: 'data.referrerName', label: 'Referrer' },
            { key: 'data.candidateName', label: 'Candidate' }, { key: 'data.status', label: 'Status' },
            { key: 'data.points', label: 'Points' }], `No referrals yet. Use New in ${containers.referrals.path}.`),
        ]),
      },
    },
  }
}

function referralsPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}') }}`,
    referralColumns, `No ${statusLabel(value).toLowerCase()} referrals`, true)
  return {
    file: 'referrals.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'referrals-list', name: 'Referrals by status', description: 'Every referral, listed by status.', icon: 'list' },
      spec: {
        access: pageAccess('List referrals by status'),
        data: referralSources,
        tree: page([
          pageHeader(
            [heading('Referrals by status'), text('Every active referral, grouped by its status. Click a row to open the referral.', 'muted')], [
            button('Referrals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'gift'),
          ]),
          containerNotice(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'gift', loading('referrals'))), 4),
          tabs(statuses.map(value => ({ value, label: statusLabel(value), icon: 'gift' })),
            statuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

function leaderboardPage() {
  return {
    file: 'leaderboard.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'referrals-leaderboard', name: 'Leaderboard', description: 'Referral points per referrer.', icon: 'trophy' },
      spec: {
        access: pageAccess('Sum referral points per referrer'),
        data: referralSources,
        tree: page([
          pageHeader(
            [heading('Leaderboard'), text('Referrers ranked by awarded points. Points are awarded when a referral is marked hired.', 'muted')], [
            button('Referrals', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'gift'),
          ]),
          containerNotice(),
          stats([
            stat('Referrers', `{{ ${referrers}.length }}`, 'users', loading('referrals')),
            stat('Hired', `{{ ${hiredRows}.length }}`, 'check', loading('referrals')),
            stat('Points awarded', totalPoints, 'trophy', loading('referrals')),
            stat('Open', countOf("['submitted','in-process'].includes(r.status)"), 'hourglass', loading('referrals')),
          ]),
          card('By referrer', [table(`{{ ${perReferrer} }}`,
            [['referrer', 'Referrer'], ['referrals', 'Referrals', 'end'], ['hired', 'Hired', 'end'], ['points', 'Points', 'end']],
            'No referrals yet')]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), referralsPage(), leaderboardPage(), ...recordKinds.map(recordForm), settingsForm(), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
