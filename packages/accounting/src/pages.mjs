// Generates the Accounting Canvas documents: one bound form per record kind, the settings form, the launch page
// and the financial reports page. Ledger rules (balancing, open periods, immutability once posted) are enforced by
// the posting script the forms run; the forms only lock what the script has posted.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, documentsPanel, folder, grid, heading, iconName,
  jsonFile, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, saveSteps, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, formControl, toneExpression, humanize,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { balancesWidgetFile, entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = {
  success: ['posted', 'closed'],
  warning: ['draft'],
  danger: ['reversed'],
  info: ['open', 'asset', 'liability', 'equity', 'income', 'expense'],
}
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Accounting schemas and run the posting script' }
const accountsAccess = reason => ({ path: containers.accounts.path, reason })
const accountLabel = "(e.data.number ? e.data.number + ' ' : '') + (e.data.name || '')"
const accountSources = {
  accounts: folder(containers.accounts.path, mimeTypes.account),
  accountoptions: { kind: 'computed', expr: options('accounts', accountLabel) },
}
const ofTypes = types => `${JSON.stringify(types)}.includes(e.data.accountType)`

// Report arithmetic runs in the Canvas expression language, which has only floating point numbers, so amounts are
// summed as integer ten-thousandths (exact for every amount a file can hold) and only divided for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`
const postedJournals = (range = '') =>
  `(data.journals || []).filter(j => j.kind === 'file' && j.data && j.data.status === 'posted' && Array.isArray(j.data.lines)${range})`
const signedLines = (account, source) =>
  `${source}.reduce((sum, j) => sum + j.data.lines.filter(l => l.account === ${account}).reduce((s, l) => s + (l.direction === 'debit' ? 1 : -1) * ${units('l.amount')}, 0), 0)`

const reversalState = { reversaldate: '', reversalreason: '' }
const reversalInputs = visible => grid([
  { type: 'canvas.form.date', props: { label: 'Reversal date', description: 'Defaults to today.', value: '{{ state.reversaldate }}' }, rules: { visible } },
  { type: 'canvas.form.input', props: { label: 'Reason', placeholder: 'Why is this being reversed?', value: '{{ state.reversalreason }}' }, rules: { visible } },
])
const reversalParameters = { date: '{{ state.reversaldate }}', reason: '{{ state.reversalreason }}' }
const idle = 'form.saving || form.dirty'

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
function recordExtras(kind) {
  if (kind === 'account') {
    const ledger = `${postedJournals()}.reduce((rows, j) => rows.concat(j.data.lines.filter(l => l.account === ctx.file.path).map(l => ({ path: j.path, date: j.data.date, journal: j.data.code || j.name, description: l.description || j.data.description, debit: l.direction === 'debit' ? l.amount : '', credit: l.direction === 'credit' ? l.amount : '' }))), []).sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))`
    return {
      access: [{ path: containers.journals.path, reason: 'Show the postings to this account' }],
      data: { journals: folder(containers.journals.path, mimeTypes.journal) },
      tabs: [{ value: 'ledger', label: 'Ledger', icon: 'list' }],
      panels: [panel('ledger', [
        ...status('journals'),
        stats([stat('Balance (debit − credit)', `{{ ${display(signedLines('ctx.file.path', postedJournals()))} }}`, 'scale', "{{ data.$journals.status === 'loading' }}")], 3),
        table(`{{ ${ledger} }}`, [['date', 'Date'], ['journal', 'Journal'], ['description', 'Description'], ['debit', 'Debit', 'end'], ['credit', 'Credit', 'end']],
          'No posted journals use this account yet', true),
      ])],
    }
  }
  if (kind === 'period') {
    return {
      locked: "form.values.status === 'closed'",
      buttons: [
        button('Close period', 'close-period', { visible: `form.values.status === 'open' && !(${archived})`, disabled: idle }, 'outline', 'lock'),
        button('Reopen', 'reopen-period', { visible: "form.values.status === 'closed'", disabled: idle }, 'ghost', 'lock-open'),
      ],
      actions: {
        'close-period': { steps: [
          { confirm: { title: 'Close period', message: 'Close this period? Nothing can be posted into its dates until it is reopened.' } },
          ...saveSteps({ status: 'closed', closedAt: '{{ Date() }}' }),
        ] },
        'reopen-period': { steps: [
          { confirm: { title: 'Reopen period', message: 'Reopen this closed period so postings can be dated in it again?' } },
          ...saveSteps({ status: 'open', closedAt: '{{ undefined }}' }),
        ] },
      },
    }
  }
  if (kind === 'journal') {
    const draft = "(!form.values.status || form.values.status === 'draft')"
    const reversible = "form.values.status === 'posted' && !form.values.reversedBy && !form.values.source && !form.values.reversalOf"
    const sum = direction => `{{ ${display(`(form.values.lines || []).filter(l => l.direction === '${direction}').reduce((s, l) => s + ${units('l.amount')}, 0)`)} }}`
    return {
      locked: `!${draft}`,
      access: [accountsAccess('Choose the accounts of journal lines')],
      data: accountSources,
      state: reversalState,
      notices: [
        stats([stat('Debits', sum('debit'), 'arrow-down-left'), stat('Credits', sum('credit'), 'arrow-up-right')], 2),
        reversalInputs(reversible),
      ],
      buttons: [
        button('Post', 'post', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
        button('Reverse', 'reverse', { visible: reversible, disabled: idle }, 'outline', 'undo-2'),
      ],
      links: [
        linkButton('Period', 'form.values.period && form.values.period.path', 'calendar-range'),
        linkButton('Source', 'form.values.source && form.values.source.path', 'corner-left-up'),
        linkButton('Reverses', 'form.values.reversalOf && form.values.reversalOf.path', 'undo-2'),
        linkButton('Reversed by', 'form.values.reversedBy && form.values.reversedBy.path', 'redo-2'),
      ],
      actions: {
        post: scriptAction(postScriptPath, 'post-journal', { confirm: { title: 'Post journal', message: 'Post this journal to the ledger? Posted journals cannot be edited, only reversed.' } }),
        reverse: scriptAction(postScriptPath, 'reverse-journal', { confirm: { title: 'Reverse journal', message: 'Post a journal that reverses every line of this one?' }, parameters: reversalParameters }),
      },
    }
  }
  const reversible = "form.values.status === 'posted'"
  return {
    locked: "!!form.values.status && form.values.status !== 'draft'",
    access: [accountsAccess('Choose the expense and payment accounts'), { path: settingsPath, reason: 'Offer the tax codes' }],
    data: {
      ...accountSources,
      settings: jsonFile(settingsPath),
      expenseaccountoptions: { kind: 'computed', expr: options('accounts', accountLabel, ofTypes(['expense', 'asset'])) },
      paymentaccountoptions: { kind: 'computed', expr: options('accounts', accountLabel, ofTypes(['asset', 'liability', 'equity'])) },
      taxcodeoptions: { kind: 'computed', expr: "((data.settings && data.settings.taxCodes) || []).map(t => ({ label: t.code + ' · ' + t.name + ' (' + t.ratePercent + '%)', value: t.code }))" },
    },
    state: reversalState,
    notices: [
      ...status('settings', `Accounting settings could not be read from ${settingsPath}. Tax codes are unavailable.`),
      { ...text('Gross amount {{ form.values.currency }} {{ form.values.grossAmount }}', 'muted'), rules: { visible: '!!form.values.grossAmount' } },
      reversalInputs(reversible),
    ],
    buttons: [
      button('Post', 'post', { visible: `(!form.values.status || form.values.status === 'draft') && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      button('Reverse', 'reverse', { visible: reversible, disabled: idle }, 'outline', 'undo-2'),
    ],
    links: [
      linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen'),
      linkButton('Reversal', 'form.values.reversalJournal && form.values.reversalJournal.path', 'undo-2'),
    ],
    actions: {
      post: scriptAction(postScriptPath, 'post-expense', { confirm: { title: 'Post expense', message: 'Post this expense to the ledger? Posted expenses cannot be edited, only reversed.' } }),
      reverse: scriptAction(postScriptPath, 'reverse-expense', { confirm: { title: 'Reverse expense', message: 'Reverse this expense\'s journal?' }, parameters: reversalParameters }),
    },
    tabs: [{ value: 'documents', label: 'Receipts', icon: 'paperclip' }],
    panels: [documentsPanel('Receipts and supporting documents for this expense.')],
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = extras.locked ?? 'false'
  const readOnly = `${archived} || (${locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...(extras.buttons ?? []), recordButtons(locked)]),
  ], 'between')
  const overview = [
    ...(extras.links?.length ? [row(extras.links)] : []),
    ...(extras.notices ?? []),
    grid(sectionCards(entity.sections, readOnly)),
  ]
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...(extras.tabs
      ? [tabs([{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...extras.tabs], [panel('overview', overview), ...extras.panels])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `accounting-${kind}`, displayName: `Accounting ${entity.singular.toLowerCase()}`,
      description: `View and edit an Accounting ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...(extras.access ?? []), schemaAccess],
      data: extras.data, state: extras.state, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'accounting-settings', displayName: 'Accounting settings', description: 'Edit the Accounting settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [accountsAccess('Choose the account each tax code posts to'), schemaAccess],
      data: accountSources,
      tree: [
        row([
          column([heading('Accounting settings'), text('The ledger currency and precision, the fiscal year and the tax codes expenses and invoices use. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        { ...text(`Set the base currency before posting: the ledger is kept in one currency.`, 'muted'), rules: { visible: '!form.values.baseCurrency' } },
        card('Settings', [grid(settingsFields.map(field => formControl(field, null)))]),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const code = { key: 'name', label: 'Code' }

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [code, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'accounting-home', name: 'Accounting', description: 'Accounting overview.', icon: 'book-open' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          accountsAccess('List the chart of accounts'),
          { path: containers.journals.path, reason: 'List journals' },
          { path: containers.expenses.path, reason: 'List expenses' },
          { path: containers.periods.path, reason: 'List accounting periods' },
        ],
        data: {
          accounts: folder(containers.accounts.path, mimeTypes.account),
          journals: folder(containers.journals.path, mimeTypes.journal),
          expenses: folder(containers.expenses.path, mimeTypes.expense),
          periods: folder(containers.periods.path, mimeTypes.period),
        },
        tree: page([
          row([
            column([heading('Accounting'), text('A double-entry ledger as files in your workspace. Draft journals and expenses in their folders, then post them from their forms.', 'muted')]),
            row([
              button('Reports', [openFile(`${installRoot}/canvas/reports.page.yaml`)], undefined, 'outline', 'chart-column'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Accounts', count('accounts'), 'book-open', loading('accounts')),
            stat('Open periods', count('periods', "e.data.status === 'open'"), 'calendar-range', loading('periods')),
            stat('Draft journals', count('journals', "e.data.status === 'draft'"), 'notebook-pen', loading('journals')),
            stat('Draft expenses', count('expenses', "e.data.status === 'draft'"), 'receipt', loading('expenses')),
          ]),
          ...Object.entries({ accounts: 'accounts', periods: 'periods', journals: 'journals', expenses: 'expenses' }).map(([source, name]) =>
            status(source, `The ${containers[name].path} folder could not be read. Reinstall Accounting to recreate it.`)[0]),
          tabs([
            { value: 'journals', label: 'Journals', icon: 'notebook-pen' },
            { value: 'expenses', label: 'Expenses', icon: 'receipt' },
            { value: 'accounts', label: 'Chart of accounts', icon: 'book-open' },
            { value: 'periods', label: 'Periods', icon: 'calendar-range' },
          ], [
            panel('journals', [row([button('Open /journals', [openFile(containers.journals.path)], undefined, 'outline', 'folder-open')]),
              browse('journals', 'journal', [{ key: 'data.date', label: 'Date' }, { key: 'data.description', label: 'Description' }, { key: 'data.status', label: 'Status' }])]),
            panel('expenses', [row([button('Open /expenses', [openFile(containers.expenses.path)], undefined, 'outline', 'folder-open')]),
              browse('expenses', 'expense', [{ key: 'data.date', label: 'Date' }, { key: 'data.description', label: 'Description' }, { key: 'data.netAmount', label: 'Net', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('accounts', [row([button('Open /chart-of-accounts', [openFile(containers.accounts.path)], undefined, 'outline', 'folder-open')]),
              browse('accounts', 'account', [{ key: 'data.number', label: 'Number' }, { key: 'data.name', label: 'Name' }, { key: 'data.accountType', label: 'Type' }])]),
            panel('periods', [row([button('Open /periods', [openFile(containers.periods.path)], undefined, 'outline', 'folder-open')]),
              browse('periods', 'period', [{ key: 'data.name', label: 'Name' }, { key: 'data.startDate', label: 'Start' }, { key: 'data.endDate', label: 'End' }, { key: 'data.status', label: 'Status' }])]),
          ]),
        ]),
      },
    },
  }
}

function reportsPage() {
  const inRange = " && (!state.fromdate || j.data.date >= state.fromdate) && (!state.todate || j.data.date <= state.todate)"
  const upTo = " && (!state.todate || j.data.date <= state.todate)"
  const balances = range => `(data.accounts || []).filter(e => e.kind === 'file' && e.data && e.data.kind === 'account').map(e => ({ path: e.path, code: e.data.code || e.name, number: e.data.number || '', name: e.data.name || '', type: e.data.accountType, units: ${signedLines('e.path', postedJournals(range))} })).sort((a, b) => (String(a.number) + a.code < String(b.number) + b.code ? -1 : 1))`
  const of = (source, types) => `(data.${source} || []).filter(b => ${JSON.stringify(types)}.includes(b.type) && b.units !== 0)`
  const total = (source, types, sign = 1) => `${of(source, types)}.reduce((s, b) => s + ${sign} * b.units, 0)`
  const rows = (source, types, sign = 1) => `{{ ${of(source, types)}.map(b => ({ path: b.path, number: b.number, name: b.name, amount: ${display(`${sign} * b.units`)} })) }}`
  const accountColumns = [['number', 'Number'], ['name', 'Account'], ['amount', 'Amount', 'end']]
  const profit = source => `(${total(source, ['income'], -1)} - ${total(source, ['expense'])})`
  const shown = value => `{{ ${display(value)} }}`
  const trialRows = "{{ (data.period || []).filter(b => b.units !== 0).map(b => ({ path: b.path, number: b.number, name: b.name, type: b.type, debit: b.units > 0 ? (b.units / 10000).toFixed(2) : '', credit: b.units < 0 ? (-b.units / 10000).toFixed(2) : '' })) }}"
  const ledgerRows = `{{ ${postedJournals(inRange)}.reduce((rows, j) => rows.concat(j.data.lines.map(l => ({ path: j.path, date: j.data.date, journal: j.data.code || j.name, account: l.account.split('/').pop(), description: l.description || j.data.description, debit: l.direction === 'debit' ? l.amount : '', credit: l.direction === 'credit' ? l.amount : '' }))), []).sort((a, b) => (a.date + a.journal < b.date + b.journal ? -1 : 1)) }}`
  return {
    file: 'reports.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'accounting-reports', name: 'Financial reports', description: 'Trial balance, profit and loss, balance sheet and general ledger.', icon: 'chart-column' },
      spec: {
        access: [accountsAccess('Report on the chart of accounts'), { path: containers.journals.path, reason: 'Sum the posted journals' }],
        data: {
          accounts: folder(containers.accounts.path, mimeTypes.account),
          journals: folder(containers.journals.path, mimeTypes.journal),
          // Movements within the chosen dates (trial balance, profit and loss) and positions up to the end date (balance sheet).
          period: { kind: 'computed', expr: balances(inRange) },
          position: { kind: 'computed', expr: balances(upTo) },
        },
        state: { fromdate: '', todate: '' },
        tree: page([
          row([
            column([heading('Financial reports'), text('Computed from posted journals. Choose dates to limit the period; the balance sheet shows positions at the end date.', 'muted')]),
            button('Accounting', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'book-open'),
          ], 'between'),
          grid([
            { type: 'canvas.form.date', props: { label: 'From', value: '{{ state.fromdate }}' } },
            { type: 'canvas.form.date', props: { label: 'To', value: '{{ state.todate }}' } },
          ]),
          ...status('accounts'), ...status('journals'),
          tabs([
            { value: 'trial', label: 'Trial balance', icon: 'scale' },
            { value: 'profit', label: 'Profit and loss', icon: 'trending-up' },
            { value: 'balance', label: 'Balance sheet', icon: 'landmark' },
            { value: 'ledger', label: 'General ledger', icon: 'list' },
          ], [
            panel('trial', [
              stats([
                stat('Total debits', shown("(data.period || []).filter(b => b.units > 0).reduce((s, b) => s + b.units, 0)"), 'arrow-down-left', loading('journals')),
                stat('Total credits', shown("(data.period || []).filter(b => b.units < 0).reduce((s, b) => s - b.units, 0)"), 'arrow-up-right', loading('journals')),
              ], 2),
              table(trialRows, [['number', 'Number'], ['name', 'Account'], ['type', 'Type'], ['debit', 'Debit', 'end'], ['credit', 'Credit', 'end']], 'No postings in this period', true),
            ]),
            panel('profit', [
              stats([
                stat('Income', shown(total('period', ['income'], -1)), 'trending-up', loading('journals')),
                stat('Expenses', shown(total('period', ['expense'])), 'trending-down', loading('journals')),
                stat('Net profit', shown(profit('period')), 'scale', loading('journals')),
              ], 3),
              card('Income', [table(rows('period', ['income'], -1), accountColumns, 'No income in this period', true)]),
              card('Expenses', [table(rows('period', ['expense']), accountColumns, 'No expenses in this period', true)]),
            ]),
            panel('balance', [
              stats([
                stat('Assets', shown(total('position', ['asset'])), 'wallet', loading('journals')),
                stat('Liabilities', shown(total('position', ['liability'], -1)), 'credit-card', loading('journals')),
                stat('Equity incl. earnings', shown(`(${total('position', ['equity'], -1)} + ${profit('position')})`), 'landmark', loading('journals')),
              ], 3),
              card('Assets', [table(rows('position', ['asset']), accountColumns, 'No assets', true)]),
              card('Liabilities', [table(rows('position', ['liability'], -1), accountColumns, 'No liabilities', true)]),
              card('Equity', [
                table(rows('position', ['equity'], -1), accountColumns, 'No equity postings', true),
                text(`Retained earnings (income less expenses to date): ${shown(profit('position'))}`, 'muted'),
              ]),
            ]),
            panel('ledger', [table(ledgerRows, [['date', 'Date'], ['journal', 'Journal'], ['account', 'Account'], ['description', 'Description'], ['debit', 'Debit', 'end'], ['credit', 'Credit', 'end']], 'No postings in this period', true)]),
          ]),
        ]),
      },
    },
  }
}

/**
 * The workspace dashboard widget (`spec.widgets`): current balances of the balance-sheet accounts from posted
 * journals. Assets show as debit balances, liabilities and equity as credit balances.
 */
function balancesWidget() {
  const sheetTypes = ['asset', 'liability', 'equity']
  const balances = `(data.accounts || []).filter(e => e.kind === 'file' && e.data && e.data.kind === 'account' && ${JSON.stringify(sheetTypes)}.includes(e.data.accountType)).map(e => ({ path: e.path, code: e.data.code || e.name, number: e.data.number || '', name: e.data.name || '', type: e.data.accountType, units: (e.data.accountType === 'asset' ? 1 : -1) * ${signedLines('e.path', postedJournals())} })).filter(b => b.units !== 0).sort((a, b) => (String(a.number) + a.code < String(b.number) + b.code ? -1 : 1))`
  const total = type => `{{ ${display(`(data.balances || []).filter(b => b.type === '${type}').reduce((s, b) => s + b.units, 0)`)} }}`
  return {
    file: balancesWidgetFile,
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'accounting-balances-widget', name: 'Balances', description: 'Balance-sheet account balances for the workspace dashboard.', icon: 'scale' },
      spec: {
        access: [accountsAccess('Show the balance-sheet accounts'), { path: containers.journals.path, reason: 'Sum the posted journals' }],
        data: {
          accounts: folder(containers.accounts.path, mimeTypes.account),
          journals: folder(containers.journals.path, mimeTypes.journal),
          balances: { kind: 'computed', expr: balances },
        },
        tree: [column([
          row([
            column([heading('Balances', 3), text(`Assets ${total('asset')} · Liabilities ${total('liability')}`, 'muted')]),
            button('Reports', [openFile(`${installRoot}/canvas/reports.page.yaml`)], undefined, 'ghost', 'chart-column'),
          ], 'between'),
          status('accounts')[0], status('journals')[0],
          { ...text('Loading…', 'muted'), rules: { visible: "data.$accounts.status === 'loading' || data.$journals.status === 'loading'" } },
          table(`{{ (data.balances || []).map(b => ({ path: b.path, account: [b.number, b.name].filter(Boolean).join(' '), type: b.type, balance: ${display('b.units')} })) }}`,
            [['account', 'Account'], ['type', 'Type'], ['balance', 'Balance', 'right']], 'No posted balances yet', true),
        ], 2)],
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), reportsPage(), balancesWidget(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
