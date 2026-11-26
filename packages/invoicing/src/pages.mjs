// Generates the Invoicing Canvas documents: one bound form per record kind, the settings form, the launch page and
// the receivables page. Issuing and posting (totals, journals, document copies, immutability) are done by the
// posting script the forms run; the forms only lock what the script has issued or posted.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, documentsPanel, folder, formControl, grid, heading,
  humanize, iconName, jsonFile, appOperationsSource, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle, customerLines, documentPreview, pdfSteps,
} from '../../../tools/file-apps/canvas.mjs'
import { accounting, containers, crm, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { dueWidgetFile, entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['issued', 'posted'], warning: ['draft'], danger: ['reversed'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Invoicing schemas and run the posting script' }
const accountsAccess = reason => ({ path: accounting.accounts, reason })
const accountLabel = "(e.data.number ? e.data.number + ' ' : '') + (e.data.name || '')"
const accountSources = {
  accounts: folder(accounting.accounts, accounting.accountMime),
  accountoptions: { kind: 'computed', expr: options('accounts', accountLabel) },
}
const invoiceSources = {
  invoices: folder(containers.invoices.path, mimeTypes.invoice),
  invoiceoptions: { kind: 'computed', expr: options('invoices', "((e.data.customer && e.data.customer.name) || '') + ' · ' + e.data.currency + ' ' + ((e.data.totals && e.data.totals.gross) || '')", "e.data.status === 'issued'") },
}
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`
const issuedCredits = invoice => `(data.credits || []).filter(c => c.kind === 'file' && c.data && c.data.status === 'issued' && c.data.invoice === ${invoice}).reduce((s, c) => s + ${units('c.data.totals.gross')}, 0)`
const allocatedPayments = invoice => `(data.payments || []).filter(p => p.kind === 'file' && p.data && p.data.status === 'posted').reduce((s, p) => s + (p.data.allocations || []).filter(a => a.invoice === ${invoice}).reduce((t, a) => t + ${units('a.amount')}, 0), 0)`
const settlementSources = {
  credits: folder(containers.credits.path, mimeTypes.credit),
  payments: folder(containers.payments.path, mimeTypes.payment),
}

// A draft's totals, estimated in cents the way the script computes them (each line rounded) for display while editing.
const lineNet = "Math.round(Number(l.quantity || 0) * Math.round(Number(l.unitPrice || 0) * 100))"
const lineRate = "Number(l.taxRate === '' || l.taxRate == null ? ((data.settings && data.settings.defaultTaxRate) || 0) : l.taxRate)"
const estimate = {
  net: `(form.values.lines || []).reduce((s, l) => s + ${lineNet}, 0)`,
  tax: `(form.values.lines || []).reduce((s, l) => s + Math.round(${lineNet} * ${lineRate} / 100), 0)`,
}

// What issuing or posting will write to the ledger, shown in the confirmation: the same lines the script posts.
const accountName = key => `((((data.accounts || []).find(a => a.path === (data.settings && data.settings.${key})) || {}).data || {}).name || 'the ${key.replace(/Account$/, '')} account (choose it in settings)')`
const cents = value => `(${value} / 100).toFixed(2)`
const journalPreview = (reverse) => {
  const net = cents(estimate.net)
  const tax = cents(estimate.tax)
  const gross = cents(`(${estimate.net} + ${estimate.tax})`)
  const [debit, credit] = reverse ? ['Credit', 'Debit'] : ['Debit', 'Credit']
  return `{{ [{ label: '${debit} ' + ${accountName('receivableAccount')}, value: ${gross} }, { label: '${credit} ' + ${accountName('incomeAccount')}, value: ${net} }].concat(${estimate.tax} ? [{ label: '${credit} ' + ${accountName('taxAccount')}, value: ${tax} }] : []) }}`
}

/** A button whose disabled state explains itself. */
const withReason = (node, reason) => ({ ...node, props: { ...node.props, reason } })

function totalsStats() {
  const cents = value => `(${value} / 100).toFixed(2)`
  const shown = (key, estimated) => `{{ form.values.totals ? form.values.totals.${key} : ${cents(estimated)} }}`
  return [
    stats([
      stat('Net', shown('net', estimate.net), 'sigma'),
      stat('Tax', shown('tax', estimate.tax), 'percent'),
      stat('Total {{ form.values.currency }}', shown('gross', `(${estimate.net} + ${estimate.tax})`), 'receipt'),
    ], 3),
    { ...text('Estimated while drafting; issuing computes the exact totals.', 'muted'), rules: { visible: '!form.values.totals' } },
  ]
}

const fromCrm = field => `(e.data.${field} || '')`
const address = field => `((e.data.address || {}).${field} || '')`
const copyCustomer = `(data.companies || []).concat(data.contacts || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.customerRef).map(e => ({ name: e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' '), legalName: ${fromCrm('legalName')}, email: ${fromCrm('email')}, phone: ${fromCrm('phone')}, taxIdentifier: ${fromCrm('taxIdentifier')}, address: { lines: (e.data.address || {}).lines || [], city: ${address('city')}, region: ${address('region')}, postalCode: ${address('postalCode')}, country: ${address('country')} } }))[0] || form.values.customer`

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
function recordExtras(kind) {
  if (kind === 'invoice') {
    const outstanding = `${units('form.values.totals.gross')} - ${issuedCredits('ctx.file.path')} - ${allocatedPayments('ctx.file.path')}`
    return {
      access: [
        { path: crm.customers, reason: 'Offer CRM customers to bill (when CRM is installed)' },
        { path: containers.credits.path, reason: 'Show the credit notes against this invoice' },
        { path: containers.payments.path, reason: 'Show the payments allocated to this invoice' },
        { path: settingsPath, reason: 'Estimate tax with the default rate' },
        accountsAccess('Name the accounts the invoice posts to'),
      ],
      data: {
        ...appOperationsSource,
        ...accountSources,
        companies: folder(crm.customers, crm.companyMime),
        contacts: folder(crm.customers, crm.contactMime),
        customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
        settings: jsonFile(settingsPath),
        ...settlementSources,
      },
      notices: [
        ...totalsStats(),
        { ...stats([
          stat('Credited', `{{ ${display(issuedCredits('ctx.file.path'))} }}`, 'file-minus'),
          stat('Paid', `{{ ${display(allocatedPayments('ctx.file.path'))} }}`, 'banknote'),
          stat('Outstanding', `{{ form.values.totals ? ${display(outstanding)} : '' }}`, 'hourglass'),
        ], 3), rules: { visible: "form.values.status === 'issued'" } },
      ],
      buttons: [
        button('Copy details', 'copy-customer', { visible: `${draft} && !!form.values.customerRef`, disabled: `form.saving || ${archived}` }, 'outline', 'copy'),
        button('Save PDF', 'savepdf', { visible: draft, disabled: idle }, 'outline', 'file-down'),
        button('Issue', 'issue', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      ],
      links: [
        linkButton('Document', 'form.values.document && form.values.document.path', 'file-text'),
        linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen'),
        linkButton('CRM customer', 'form.values.customerRef', 'building-2'),
      ],
      actions: {
        'copy-customer': { steps: [{ 'patch-form': { values: { customer: `{{ ${copyCustomer} }}` } } }] },
        savepdf: { steps: pdfSteps(invoiceTemplate('invoice')) },
        issue: withIssuedCopy('invoice', scriptAction(postScriptPath, 'issue-invoice', { confirm: { title: 'Issue invoice', details: journalPreview(false), message: 'Issue this invoice and post it to the ledger? Issued invoices cannot be edited; correct them with a credit note.' } })),
      },
      tabs: [
        { value: 'settlement', label: 'Credits and payments', icon: 'banknote' },
        { value: 'documents', label: 'Documents', icon: 'paperclip' },
      ],
      panels: [
        panel('settlement', [
          card('Credit notes', [table(`{{ (data.credits || []).filter(c => c.kind === 'file' && c.data && c.data.invoice === ctx.file.path).map(c => ({ path: c.path, code: c.data.code || c.name, date: c.data.date, reason: c.data.reason, status: c.data.status, gross: (c.data.totals && c.data.totals.gross) || '' })) }}`,
            [['code', 'Number'], ['date', 'Date'], ['reason', 'Reason'], ['status', 'Status'], ['gross', 'Total', 'end']], 'No credit notes against this invoice', true)]),
          card('Payments', [table(`{{ (data.payments || []).filter(p => p.kind === 'file' && p.data && (p.data.allocations || []).some(a => a.invoice === ctx.file.path)).map(p => ({ path: p.path, code: p.data.code || p.name, date: p.data.date, status: p.data.status, amount: p.data.allocations.filter(a => a.invoice === ctx.file.path).map(a => a.amount).join(' + ') })) }}`,
            [['code', 'Payment'], ['date', 'Date'], ['status', 'Status'], ['amount', 'Allocated', 'end']], 'No payments allocated to this invoice', true)]),
        ]),
        documentsPanel('The issued invoice copy and any supporting documents.'),
      ],
    }
  }
  if (kind === 'credit') {
    return {
      access: [{ path: containers.invoices.path, reason: 'Choose the issued invoice to credit' }, { path: settingsPath, reason: 'Estimate tax with the default rate' }, accountsAccess('Name the accounts the credit note posts to')],
      data: { ...invoiceSources, ...accountSources, ...appOperationsSource, settings: jsonFile(settingsPath) },
      notices: totalsStats(),
      buttons: [
        button('Save PDF', 'savepdf', { visible: draft, disabled: idle }, 'outline', 'file-down'),
        button('Issue', 'issue', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      ],
      links: [
        linkButton('Invoice', 'form.values.invoice', 'file-text'),
        linkButton('Document', 'form.values.document && form.values.document.path', 'file-minus'),
        linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen'),
      ],
      actions: {
        savepdf: { steps: pdfSteps(invoiceTemplate('credit')) },
        issue: withIssuedCopy('credit', scriptAction(postScriptPath, 'issue-credit', { confirm: { title: 'Issue credit note', details: journalPreview(true), message: 'Issue this credit note against its invoice and post it to the ledger? Issued credit notes cannot be edited.' } })),
      },
      tabs: [{ value: 'documents', label: 'Documents', icon: 'paperclip' }],
      panels: [documentsPanel('The issued credit note copy and any supporting documents.')],
    }
  }
  const reversible = "form.values.status === 'posted'"
  const visibleWhenReversible = { visible: reversible }
  return {
    access: [
      accountsAccess('Choose the bank account'), { path: containers.invoices.path, reason: 'Choose the invoices a payment settles' },
      { path: containers.credits.path, reason: 'Work out what each invoice still owes' }, { path: containers.payments.path, reason: 'Work out what each invoice still owes' },
    ],
    data: {
      ...appOperationsSource,
      ...accountSources, ...invoiceSources, ...settlementSources,
      // The payer's open invoices in this currency, oldest due date first, with what each still owes in ten-thousandths.
      openinvoices: { kind: 'computed', expr: `(data.invoices || []).filter(e => e.kind === 'file' && e.data && e.data.status === 'issued' && e.data.totals && e.data.currency === form.values.currency && String((e.data.customer && e.data.customer.name) || '').toLowerCase() === String(form.values.payer || '').trim().toLowerCase()).map(e => ({ path: e.path, due: e.data.dueDate || '', open: ${units('e.data.totals.gross')} - ${issuedCredits('e.path')} - ${allocatedPayments('e.path')} })).filter(e => e.open > 0).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))` },
      bankaccountoptions: { kind: 'computed', expr: options('accounts', accountLabel, "e.data.accountType === 'asset'") },
    },
    state: { reversaldate: '', reversalreason: '' },
    notices: [
      { ...text("Allocated {{ ((form.values.allocations || []).reduce((s, a) => s + Math.round(Number(a.amount || 0) * 100), 0) / 100).toFixed(2) }} of {{ form.values.amount || '0.00' }}", 'muted') },
      grid([
        { type: 'canvas.form.date', props: { label: 'Reversal date', description: 'Defaults to today.', value: '{{ state.reversaldate }}' }, rules: visibleWhenReversible },
        { type: 'canvas.form.input', props: { label: 'Reason', placeholder: 'Why is this being reversed?', value: '{{ state.reversalreason }}' }, rules: visibleWhenReversible },
      ]),
    ],
    buttons: [
      withReason(button('Allocate oldest first', 'allocate', { visible: `${draft} && !(${archived})`, disabled: "form.saving || !form.values.payer || !(Number(form.values.amount) > 0) || (data.openinvoices || []).length === 0" }, 'outline', 'list-ordered'),
        "{{ !form.values.payer ? 'Enter the payer first' : (data.openinvoices || []).length === 0 ? 'The payer has no open invoices in this currency' : '' }}"),
      button('Post', 'post', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      button('Reverse', 'reverse', { visible: reversible, disabled: idle }, 'outline', 'undo-2'),
    ],
    links: [
      linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen'),
      linkButton('Reversal', 'form.values.reversalJournal && form.values.reversalJournal.path', 'undo-2'),
    ],
    actions: {
      allocate: { steps: [{ 'patch-form': { values: { allocations: { $expr: `(data.openinvoices || []).reduce((acc, inv) => acc.left <= 0 ? acc : ({ left: acc.left - Math.min(acc.left, inv.open), rows: acc.rows.concat([{ invoice: inv.path, amount: ${display('Math.min(acc.left, inv.open)')} }]) }), { left: ${units('form.values.amount')}, rows: [] }).rows` } } } }] },
      post: scriptAction(postScriptPath, 'post-payment', { confirm: { title: 'Post payment', details: "{{ [{ label: 'Debit ' + ((((data.accounts || []).find(a => a.path === form.values.bankAccount) || {}).data || {}).name || 'the bank account'), value: Number(form.values.amount || 0).toFixed(2) }].concat((form.values.allocations || []).map(a => ({ label: 'Settles ' + (((data.invoiceoptions || []).find(o => o.value === a.invoice) || {}).label || a.invoice), value: Number(a.amount || 0).toFixed(2) }))) }}", message: 'Post this payment to the ledger and settle its allocations? Posted payments cannot be edited, only reversed.' } }),
      reverse: scriptAction(postScriptPath, 'reverse-payment', {
        confirm: { title: 'Reverse payment', message: 'Reverse this payment\'s journal? Its allocations no longer settle their invoices.' },
        parameters: { date: '{{ state.reversaldate }}', reason: '{{ state.reversalreason }}' },
      }),
    },
  }
}

// An invoice or credit note as the customer receives it. Issued records show the script's totals; drafts the same
// estimate as the totals above the form.
function invoiceTemplate(kind) {
  const cents = value => `(${value} / 100).toFixed(2)`
  const shown = (key, estimated) => `form.values.totals ? form.values.totals.${key} : ${cents(estimated)}`
  return ({
    title: `'${kind === 'invoice' ? 'Tax invoice' : 'Credit note'} ' + (form.values.code || '')`,
    subtitle: 'form.values.reference',
    party: customerLines, partyLabel: 'Bill to',
    meta: kind === 'invoice'
      ? [['Issued', "format(form.values.issueDate, 'date')"], ['Due', "format(form.values.dueDate, 'date')"], ['Currency', 'form.values.currency']]
      : [['Issued', "format(form.values.issueDate || form.values.date, 'date')"], ['Currency', 'form.values.currency']],
    lines: `(form.values.lines || []).map(l => ({ item: l.description || '', quantity: l.quantity, price: Number(l.unitPrice || 0).toFixed(2), tax: (${lineRate}) + '%', amount: (${lineNet} / 100).toFixed(2) }))`,
    columns: [{ key: 'item', label: 'Item' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'price', label: 'Price', align: 'right' }, { key: 'tax', label: 'Tax', align: 'right' }, { key: 'amount', label: 'Amount', align: 'right' }],
    totals: [
      ['Net', shown('net', estimate.net)],
      ['Tax', shown('tax', estimate.tax)],
      ["'Total ' + (form.values.currency || '')", shown('gross', `(${estimate.net} + ${estimate.tax})`), true],
    ],
    footer: 'form.values.notes',
  })
}

/** After issuing, the issued copy is saved as a PDF in the record's documents (never replaced). */
function withIssuedCopy(kind, action) {
  // Only once the record is issued: the script had Accounting post its journal and marked it (or it already was).
  const issued = '!!state.lastresult && !state.lastresult.journalRequest'
  return { ...action, steps: [...action.steps, ...pdfSteps(invoiceTemplate(kind), { immutable: true }).map(step => {
    const [type] = Object.keys(step)
    return { [type]: { ...step[type], if: issued } }
  })] }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = `!${draft}`
  const readOnly = `${archived} || (${locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...extras.buttons, recordButtons(locked)],
  )
  const overview = [
    ...(extras.links.length ? [row(extras.links)] : []),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
    ...(kind === 'invoice' || kind === 'credit' ? [documentPreview(invoiceTemplate(kind))] : []),
  ]
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    archivedAlert(entity.singular),
    ...(extras.tabs
      ? [tabs([{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...extras.tabs], [panel('overview', overview), ...extras.panels])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `invoicing-${kind}`, displayName: `Invoicing ${entity.singular.toLowerCase()}`,
      description: `View and edit an Invoicing ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'invoicing-settings', displayName: 'Invoicing settings', description: 'Edit the Invoicing settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [accountsAccess('Choose the accounts invoices, credit notes and payments post to'), schemaAccess],
      data: accountSources,
      tree: [
        pageHeader(
          [heading('Invoicing settings'), text('Seller details, payment terms, tax and posting accounts. The currency is the Accounting base currency; number prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('accounts', `The Accounting chart of accounts (${accounting.accounts}) could not be read. Install Accounting to post invoices.`),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Issued invoices with what has been credited and paid against them, in integer ten-thousandths.
const receivables = `(data.invoices || []).filter(e => ${active} && e.data.status === 'issued' && e.data.totals).map(e => ({ path: e.path, code: e.data.code || e.name, customer: (e.data.customer && e.data.customer.name) || '', issueDate: e.data.issueDate, dueDate: e.data.dueDate, gross: ${units('e.data.totals.gross')}, credited: ${issuedCredits('e.path')}, paid: ${allocatedPayments('e.path')} })).map(r => ({ path: r.path, code: r.code, customer: r.customer, issueDate: r.issueDate, dueDate: r.dueDate, gross: r.gross, credited: r.credited, paid: r.paid, outstanding: r.gross - r.credited - r.paid, overdue: r.gross - r.credited - r.paid > 0 && r.dueDate < Date().slice(0, 10) }))`
const receivableSources = {
  invoices: folder(containers.invoices.path, mimeTypes.invoice),
  ...settlementSources,
  receivables: { kind: 'computed', expr: receivables },
}
const sumOf = filter => `{{ ${display(`(data.receivables || []).filter(r => ${filter}).reduce((s, r) => s + r.outstanding, 0)`)} }}`

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'invoicing-home', name: 'Invoicing', description: 'Invoicing overview.', icon: 'file-text' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: Object.values(containers).map(container => ({ path: container.path, reason: `List ${container.path.slice(1).split('-').join(' ')}` })),
        data: receivableSources,
        tree: page([
          pageHeader(
            [heading('Invoicing'), text('Invoices, credit notes and payments are files in your workspace. Draft them in their folders, then issue or post them from their forms to the Accounting ledger.', 'muted')], [
            row([
              button('Receivables', [openFile(`${installRoot}/canvas/receivables.page.yaml`)], undefined, 'outline', 'hourglass'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Draft invoices', count('invoices', "e.data.status === 'draft'"), 'file-pen', loading('invoices')),
            stat('Unpaid invoices', '{{ (data.receivables || []).filter(r => r.outstanding > 0).length }}', 'file-text', loading('invoices')),
            stat('Outstanding', sumOf('r.outstanding > 0'), 'hourglass', loading('payments')),
            stat('Overdue', sumOf('r.overdue'), 'alarm-clock', loading('payments')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Invoicing to recreate it.`)[0]),
          tabs([
            { value: 'invoices', label: 'Invoices', icon: 'file-text' },
            { value: 'credits', label: 'Credit notes', icon: 'file-minus' },
            { value: 'payments', label: 'Payments', icon: 'banknote' },
          ], [
            panel('invoices', [row([button('Open /invoices', [openFile(containers.invoices.path)], undefined, 'outline', 'folder-open')]),
              browse('invoices', 'invoice', [{ key: 'data.customer.name', label: 'Customer' }, { key: 'data.issueDate', label: 'Issued' }, { key: 'data.dueDate', label: 'Due' }, { key: 'data.totals.gross', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('credits', [row([button('Open /credit-notes', [openFile(containers.credits.path)], undefined, 'outline', 'folder-open')]),
              browse('credits', 'credit', [{ key: 'data.date', label: 'Date' }, { key: 'data.reason', label: 'Reason' }, { key: 'data.totals.gross', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('payments', [row([button('Open /payments', [openFile(containers.payments.path)], undefined, 'outline', 'folder-open')]),
              browse('payments', 'payment', [{ key: 'data.date', label: 'Date' }, { key: 'data.payer', label: 'Payer' }, { key: 'data.amount', label: 'Amount', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
          ]),
        ]),
      },
    },
  }
}

function receivablesPage() {
  const rows = `{{ (data.receivables || []).filter(r => state.showsettled || r.outstanding > 0).map(r => ({ path: r.path, code: r.code, customer: r.customer, dueDate: r.dueDate, gross: ${display('r.gross')}, credited: ${display('r.credited')}, paid: ${display('r.paid')}, outstanding: ${display('r.outstanding')}, state: r.overdue ? 'Overdue' : (r.outstanding > 0 ? 'Open' : 'Settled') })) }}`
  return {
    file: 'receivables.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'invoicing-receivables', name: 'Receivables', description: 'What customers owe on issued invoices.', icon: 'hourglass' },
      spec: {
        access: Object.values(containers).map(container => ({ path: container.path, reason: 'Sum issued invoices, credit notes and payment allocations' })),
        data: receivableSources,
        state: { showsettled: false },
        tree: page([
          pageHeader(
            [heading('Receivables'), text('Issued invoices less issued credit notes and posted payment allocations.', 'muted')], [
            button('Invoicing', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'file-text'),
          ]),
          ...Object.keys(containers).map(name => status(name)[0]),
          stats([
            stat('Outstanding', sumOf('r.outstanding > 0'), 'hourglass', loading('payments')),
            stat('Overdue', sumOf('r.overdue'), 'alarm-clock', loading('payments')),
            stat('Overdue invoices', '{{ (data.receivables || []).filter(r => r.overdue).length }}', 'file-warning', loading('payments')),
          ], 3),
          { type: 'canvas.form.switch', props: { label: 'Show settled invoices', value: '{{ state.showsettled }}' } },
          table(rows, [['code', 'Invoice'], ['customer', 'Customer'], ['dueDate', 'Due'], ['gross', 'Total', 'end'], ['credited', 'Credited', 'end'],
            ['paid', 'Paid', 'end'], ['outstanding', 'Outstanding', 'end'], ['state', 'State']], 'Nothing outstanding', true),
        ]),
      },
    },
  }
}

/** The workspace dashboard widget (`spec.widgets`): open invoices by due date, compact enough for a 4×4 tile. */
function dueWidget() {
  const open = '(data.receivables || []).filter(r => r.outstanding > 0)'
  const currency = "(((data.invoices || []).find(e => e.path === r.path) || {}).data || {}).currency || ''"
  const rows = `{{ ${open}.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)).map(r => ({ path: r.path, code: r.code, customer: r.customer, amount: [${currency}, ${display('r.outstanding')}].filter(Boolean).join(' '), due: r.overdue ? r.dueDate + ' · overdue' : r.dueDate })) }}`
  return {
    file: dueWidgetFile,
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'invoicing-due-widget', name: 'Invoices due', description: 'Open and overdue invoices for the workspace dashboard.', icon: 'alarm-clock' },
      spec: {
        access: Object.values(containers).map(container => ({ path: container.path, reason: 'Show open and overdue invoices' })),
        data: receivableSources,
        tree: [column([
          row([
            column([
              heading('Invoices due', 3),
              text(`{{ ${open}.length }} open · {{ ${open}.filter(r => r.overdue).length }} overdue`, 'muted'),
            ]),
            button('Receivables', [openFile(`${installRoot}/canvas/receivables.page.yaml`)], undefined, 'ghost', 'hourglass'),
          ], 'between'),
          ...Object.keys(containers).map(name => status(name)[0]),
          { ...text('Loading…', 'muted'), rules: { visible: "data.$payments.status === 'loading'" } },
          table(rows, [['code', 'Invoice'], ['customer', 'Customer'], ['amount', 'Outstanding', 'right'], ['due', 'Due']], 'Nothing outstanding', true),
        ], 2)],
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), receivablesPage(), dueWidget(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
