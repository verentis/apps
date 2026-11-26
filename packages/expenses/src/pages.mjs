// Generates the Expenses Canvas documents: one bound form per record kind, the settings form, the launch page,
// the reports list page and the by-category summary. Submitting, approving, refusing and posting (totals,
// journals, immutability) are done by the posting script the report form runs; the forms only lock what the
// script has moved beyond draft.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading, humanize,
  iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction, appOperationsSource, withAppCall,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { accounting, containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { employee, entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['approved', 'posted'], warning: ['draft'], danger: ['refused'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Expenses schemas and run the posting script' }
const accountsAccess = reason => ({ path: accounting.accounts, reason })
const accountLabel = "(e.data.number ? e.data.number + ' ' : '') + (e.data.name || '')"
const accountSources = {
  accounts: folder(accounting.accounts, accounting.accountMime),
  accountoptions: { kind: 'computed', expr: options('accounts', accountLabel) },
}
const categorySources = {
  categories: folder(containers.categories.path, mimeTypes.category),
  categoryoptions: { kind: 'computed', expr: options('categories', "e.data.name || ''") },
}
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"
const submitted = "form.values.status === 'submitted'"
const approved = "form.values.status === 'approved'"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`
const lineSum = report => `(${report}.lines || []).reduce((s, l) => s + ${units('l.amount')}, 0)`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
/** Accounting posts the journal through its API from what the script returned; the script then completes the record. */
const posting = complete => ({ app: 'accounting', operation: 'post-journal', required: true, label: 'Accounting', script: postScriptPath, recordOperation: complete,
  parameter: 'journal', field: 'journalRequest', key: "'journal-' + form.values.code" })

function recordExtras(kind) {
  if (kind === 'category') {
    return {
      access: [accountsAccess('Choose the expense account lines of this category post to')],
      data: accountSources,
      notices: [],
      buttons: [],
      links: [],
      actions: {},
      locked: 'false',
    }
  }
  const visibleWhenSubmitted = { visible: submitted }
  return {
    access: [{ path: containers.categories.path, reason: 'Offer the expense categories for each line' }, ...employee.sources.access],
    data: { ...categorySources, ...appOperationsSource, ...employee.sources.data },
    state: { approver: '', refusalreason: '' },
    notices: [
      text(`Total {{ form.values.total || ${display(lineSum('form.values'))} }}`, 'muted'),
      badge('Refused: {{ form.values.refusalReason }}', 'danger', { visible: "form.values.status === 'refused'" }),
      { ...text('Approved by {{ form.values.approver }} on {{ form.values.approvedAt }}', 'muted'), rules: { visible: '!!form.values.approver' } },
      grid([
        { type: 'canvas.form.input', props: { label: 'Approver', placeholder: 'Who approves this report?', value: '{{ state.approver }}' }, rules: visibleWhenSubmitted },
        { type: 'canvas.form.input', props: { label: 'Refusal reason', placeholder: 'Why is it refused?', value: '{{ state.refusalreason }}' }, rules: visibleWhenSubmitted },
      ]),
    ],
    buttons: [
      { ...employee.meButton, rules: { ...employee.meButton.rules, visible: `${draft} && !(${archived}) && ${employee.meButton.rules.visible}` } },
      button('Submit', 'submit', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      button('Approve', 'approve', { visible: submitted, disabled: idle }, undefined, 'check'),
      button('Refuse', 'refuse', { visible: submitted, disabled: idle }, 'outline', 'x'),
      button('Post', 'post', { visible: approved, disabled: idle }, undefined, 'notebook-pen'),
    ],
    links: [linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen')],
    actions: {
      ...employee.meAction,
      submit: scriptAction(postScriptPath, 'submit-report', {
        confirm: { title: 'Submit report', message: 'Submit this expense report for approval? Submitted reports can no longer be edited.' },
      }),
      approve: scriptAction(postScriptPath, 'approve-report', {
        confirm: { title: 'Approve report', message: 'Approve this expense report? It can then be posted to the ledger.' },
        parameters: { approver: '{{ state.approver }}' },
      }),
      refuse: scriptAction(postScriptPath, 'refuse-report', {
        confirm: { title: 'Refuse report', message: 'Refuse this expense report? Give the reason in the Refusal reason field.' },
        parameters: { reason: '{{ state.refusalreason }}' },
      }),
      post: withAppCall(scriptAction(postScriptPath, 'post-report', {
        confirm: { title: 'Post report', message: 'Post this approved report to the Accounting ledger? Posted reports cannot be edited.' },
      }), posting('complete-report')),
    },
    locked: `!${draft}`,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
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
    ...(extras.links.length ? [row(extras.links)] : []),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `expenses-${kind}`, displayName: `Expenses ${entity.singular.toLowerCase()}`,
      description: `View and edit an Expenses ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, state: extras.state, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'expenses-settings', displayName: 'Expenses settings', description: 'Edit the Expenses settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [accountsAccess('Choose the account posted reports credit'), schemaAccess],
      data: accountSources,
      tree: [
        pageHeader(
          [heading('Expenses settings'), text('The account posted reports credit (what the business owes back). The currency is the Accounting base currency; number prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('accounts', `The Accounting chart of accounts (${accounting.accounts}) could not be read. Install Accounting to post expense reports.`),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active report projected for lists, in integer ten-thousandths.
const reportRows = `(data.reports || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', date: e.data.date || '', lineCount: (e.data.lines || []).length, total: e.data.total ? ${units('e.data.total')} : ${lineSum('e.data')}, status: e.data.status || 'draft', approver: e.data.approver || '' }))`
const reportSources = {
  reports: folder(containers.reports.path, mimeTypes.report),
  categories: folder(containers.categories.path, mimeTypes.category),
  rows: { kind: 'computed', expr: reportRows },
}
const sumOf = filter => `{{ ${display(`(data.rows || []).filter(r => ${filter}).reduce((s, r) => s + r.total, 0)`)} }}`
const containerAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'expenses-home', name: 'Expenses', description: 'Expenses overview.', icon: 'receipt' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: containerAccess('List expense reports and categories'),
        data: reportSources,
        tree: page([
          pageHeader(
            [heading('Expenses'), text('Expense categories and employee expense reports are files in your workspace. Draft reports in their folder, then submit, approve and post them from their forms to the Accounting ledger.', 'muted')], [
            row([
              button('Reports', [openFile(`${installRoot}/canvas/reports.page.yaml`)], undefined, 'outline', 'receipt'),
              button('By category', [openFile(`${installRoot}/canvas/by-category.page.yaml`)], undefined, 'outline', 'tags'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Draft reports', count('reports', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('reports')),
            stat('Awaiting approval', count('reports', "e.data.status === 'submitted'"), 'hourglass', loading('reports')),
            stat('Approved, unposted', count('reports', "e.data.status === 'approved'"), 'check', loading('reports')),
            stat('To reimburse', sumOf("r.status === 'submitted' || r.status === 'approved'"), 'banknote', loading('reports')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Expenses to recreate it.`)[0]),
          tabs([
            { value: 'reports', label: 'Expense reports', icon: 'receipt' },
            { value: 'categories', label: 'Categories', icon: 'tags' },
          ], [
            panel('reports', [row([button(`Open ${containers.reports.path}`, [openFile(containers.reports.path)], undefined, 'outline', 'folder-open')]),
              browse('reports', 'report', [{ key: 'data.employeeName', label: 'Employee' }, { key: 'data.date', label: 'Date' }, { key: 'data.total', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('categories', [row([button(`Open ${containers.categories.path}`, [openFile(containers.categories.path)], undefined, 'outline', 'folder-open')]),
              browse('categories', 'category', [{ key: 'data.name', label: 'Name' }, { key: 'data.expenseAccount', label: 'Expense account' }])]),
          ]),
        ]),
      },
    },
  }
}

function reportsPage() {
  const rows = `{{ (data.rows || []).filter(r => state.showall || (r.status !== 'posted' && r.status !== 'refused')).map(r => ({ path: r.path, code: r.code, employee: r.employee, date: r.date, lineCount: r.lineCount, total: ${display('r.total')}, status: r.status, approver: r.approver })) }}`
  return {
    file: 'reports.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'expenses-reports', name: 'Expense reports', description: 'Expense reports by status.', icon: 'receipt' },
      spec: {
        access: containerAccess('List expense reports with their totals and statuses'),
        data: reportSources,
        state: { showall: false },
        tree: page([
          pageHeader(
            [heading('Expense reports'), text('Draft reports are estimates; submitting computes the exact total.', 'muted')], [
            button('Expenses', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'receipt'),
          ]),
          status('reports')[0],
          stats([
            stat('Awaiting approval', count('reports', "e.data.status === 'submitted'"), 'hourglass', loading('reports')),
            stat('Approved, unposted', count('reports', "e.data.status === 'approved'"), 'check', loading('reports')),
            stat('To reimburse', sumOf("r.status === 'submitted' || r.status === 'approved'"), 'banknote', loading('reports')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show posted and refused reports', value: '{{ state.showall }}' } },
          table(rows, [['code', 'Report'], ['employee', 'Employee'], ['date', 'Date'], ['lineCount', 'Lines', 'end'], ['total', 'Total', 'end'],
            ['status', 'Status'], ['approver', 'Approver']], 'No expense reports', true),
        ]),
      },
    },
  }
}

function byCategoryPage() {
  // Lines of reports that are on their way to or in the ledger (submitted, approved or posted).
  const spent = `(data.reports || []).filter(e => ${active} && ['submitted', 'approved', 'posted'].includes(e.data.status)).flatMap(e => (e.data.lines || []).map(l => ({ category: l.category, amount: ${units('l.amount')} })))`
  const summary = `(data.categories || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', lineCount: ${spent}.filter(l => l.category === e.path).length, total: ${spent}.filter(l => l.category === e.path).reduce((s, l) => s + l.amount, 0) }))`
  const rows = `{{ (data.summary || []).filter(c => state.showempty || c.lineCount > 0).map(c => ({ path: c.path, code: c.code, name: c.name, lineCount: c.lineCount, total: ${display('c.total')} })) }}`
  return {
    file: 'by-category.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'expenses-by-category', name: 'Expenses by category', description: 'What has been expensed against each category.', icon: 'tags' },
      spec: {
        access: containerAccess('Sum submitted, approved and posted report lines by category'),
        data: { ...reportSources, summary: { kind: 'computed', expr: summary } },
        state: { showempty: false },
        tree: page([
          pageHeader(
            [heading('Expenses by category'), text('Submitted, approved and posted report lines, summed by their category.', 'muted')], [
            button('Expenses', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'receipt'),
          ]),
          ...['reports', 'categories'].map(name => status(name)[0]),
          stats([
            stat('Categories', count('categories'), 'tags', loading('categories')),
            stat('Expensed lines', `{{ ${spent}.length }}`, 'receipt', loading('reports')),
            stat('Expensed total', `{{ ${display(`${spent}.reduce((s, l) => s + l.amount, 0)`)} }}`, 'sigma', loading('reports')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show categories without expenses', value: '{{ state.showempty }}' } },
          table(rows, [['code', 'Category'], ['name', 'Name'], ['lineCount', 'Lines', 'end'], ['total', 'Total', 'end']], 'Nothing expensed yet', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), reportsPage(), byCategoryPage(), ...recordKinds.map(recordForm), settingsForm(), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
