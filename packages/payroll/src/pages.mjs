// Generates the Payroll Canvas documents: one bound form per record kind, the settings form, the launch page and
// the structures page. Computing, approving and posting (payslips, totals, the journal, immutability) are done by
// the run script the forms run; the forms only lock what the script has posted.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading, humanize,
  iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction, appOperationsSource, withAppCall,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { accounting, containers, employees, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['approved', 'posted'], warning: ['draft'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Payroll schemas and run the pay run script' }
const accountsAccess = reason => ({ path: accounting.accounts, reason })
const accountLabel = "(e.data.number ? e.data.number + ' ' : '') + (e.data.name || '')"
const accountSources = {
  accounts: folder(accounting.accounts, accounting.accountMime),
  accountoptions: { kind: 'computed', expr: options('accounts', accountLabel) },
}
const idle = 'form.saving || form.dirty'
const draft = "(!form.values.status || form.values.status === 'draft')"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`

const totalsValue = key => `{{ (form.values.totals && form.values.totals.${key}) || '' }}`
const payslipRows = `{{ (form.values.payslips || []).map(p => ({ employee: p.employee, base: p.base, gross: p.gross, deductions: p.deductions, contributions: p.contributions, net: p.net })) }}`

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
/** Accounting posts the journal through its API from what the script returned; the script then completes the record. */
const posting = complete => ({ app: 'accounting', operation: 'post-journal', required: true, label: 'Accounting', script: postScriptPath, recordOperation: complete,
  parameter: 'journal', field: 'journalRequest', key: "'journal-' + form.values.code" })

function recordExtras(kind) {
  if (kind === 'structure') {
    return { access: [], data: {}, notices: [], buttons: [], links: [], actions: {} }
  }
  if (kind === 'profile') {
    return {
      access: [
        { path: employees.root, reason: 'Offer employee records to link (when Employees is installed)' },
        { path: containers.structures.path, reason: 'Choose the salary structure this profile is paid by' },
      ],
      data: {
        employeesrecords: folder(employees.root, employees.employeeMime),
        employeeoptions: { kind: 'computed', expr: options('employeesrecords', "(e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' ') || e.name)") },
        structures: folder(containers.structures.path, mimeTypes.structure),
        structureoptions: { kind: 'computed', expr: options('structures', "e.data.name || ''") },
      },
      notices: [
        { type: 'canvas.form.switch',
          props: { label: 'Active', description: 'Inactive profiles are skipped when a pay run is computed.', value: '{{ form.values.active }}' },
          rules: { disabled: archived } },
      ],
      buttons: [],
      links: [linkButton('Employee', 'form.values.employeeRef', 'id-card'), linkButton('Structure', 'form.values.structure', 'layers')],
      actions: {},
    }
  }
  const computed = "form.values.status === 'computed'"
  const approved = "form.values.status === 'approved'"
  return {
    access: [],
    data: { ...appOperationsSource },
    notices: [
      { ...stats([
        stat('Gross', totalsValue('gross'), 'sigma'),
        stat('Deductions', totalsValue('deductions'), 'minus'),
        stat('Employer contributions', totalsValue('contributions'), 'plus'),
        stat('Net {{ form.values.currency }}', totalsValue('net'), 'banknote'),
      ]), rules: { visible: '!!form.values.totals' } },
      card('Payslips', [
        table(payslipRows,
          [['employee', 'Employee'], ['base', 'Base', 'end'], ['gross', 'Gross', 'end'], ['deductions', 'Deductions', 'end'],
            ['contributions', 'Contributions', 'end'], ['net', 'Net', 'end']],
          'Not computed yet. Save the run, then Compute.'),
      ], 'One payslip per active pay profile, computed from its salary structure.'),
    ],
    buttons: [
      button('Compute', 'compute', { visible: `(${draft} || ${computed}) && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'calculator'),
      button('Approve', 'approve', { visible: computed, disabled: idle }, undefined, 'check'),
      button('Post', 'post', { visible: approved, disabled: idle }, undefined, 'send'),
    ],
    links: [linkButton('Journal', 'form.values.journal && form.values.journal.path', 'notebook-pen')],
    actions: {
      compute: scriptAction(postScriptPath, 'compute-run', { confirm: { title: 'Compute pay run', message: 'Compute a payslip for every active pay profile from its salary structure? Computing again replaces the payslips.' } }),
      approve: scriptAction(postScriptPath, 'approve-run', { confirm: { title: 'Approve pay run', message: 'Approve the computed payslips? An approved run is ready to post.' } }),
      post: withAppCall(scriptAction(postScriptPath, 'post-run', { confirm: { title: 'Post pay run', message: 'Post this pay run to the Accounting ledger? Posted runs are locked and cannot be edited.' } }), posting('complete-run')),
    },
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = kind === 'payrun' ? "form.values.status === 'posted'" : 'false'
  const readOnly = `${archived} || (${locked})`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...extras.buttons, recordButtons(locked)],
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
      name: `payroll-${kind}`, displayName: `Payroll ${entity.singular.toLowerCase()}`,
      description: `View and edit a Payroll ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'payroll-settings', displayName: 'Payroll settings', description: 'Edit the Payroll settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [accountsAccess('Choose the accounts pay runs post to'), schemaAccess],
      data: accountSources,
      tree: [
        pageHeader(
          [heading('Payroll settings'), text('The accounts pay runs post to. The currency is the Accounting base currency; code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
        ...status('record'),
        ...status('accounts', `The Accounting chart of accounts (${accounting.accounts}) could not be read. Install Accounting to post pay runs.`),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const byStatus = value => `e.data.status === '${value}'`
const postedNet = `(data.runs || []).filter(e => ${active} && ${byStatus('posted')} && e.data.totals).reduce((s, e) => s + ${units('e.data.totals.net')}, 0)`

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'payroll-home', name: 'Payroll', description: 'Payroll overview and pay runs.', icon: 'calendar-check' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [{ path: containers.runs.path, reason: 'List pay runs' }],
        data: { runs: folder(containers.runs.path, mimeTypes.payrun) },
        tree: page([
          pageHeader(
            [heading('Payroll'), text('A region-agnostic payroll engine: salary structures and their rules are your data. Draft a pay run for a period, Compute payslips for every active pay profile, Approve, then Post one journal to the Accounting ledger.', 'muted')], [
            row([
              button('Structures', [openFile(`${installRoot}/canvas/structures.page.yaml`)], undefined, 'outline', 'layers'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Draft runs', count('runs', byStatus('draft')), 'file-pen', loading('runs')),
            stat('Awaiting approval', count('runs', byStatus('computed')), 'calculator', loading('runs')),
            stat('Approved', count('runs', byStatus('approved')), 'check', loading('runs')),
            stat('Net paid (posted)', `{{ ${display(postedNet)} }}`, 'banknote', loading('runs')),
          ]),
          status('runs', `The ${containers.runs.path} folder could not be read. Reinstall Payroll to recreate it.`)[0],
          row([button(`Open ${containers.runs.path}`, [openFile(containers.runs.path)], undefined, 'outline', 'folder-open')]),
          browser(containers.runs.path, mimeTypes.payrun,
            [{ key: 'name', label: 'Code' }, { key: 'data.period', label: 'Period' }, { key: 'data.status', label: 'Status' },
              { key: 'data.totals.gross', label: 'Gross', align: 'end' }, { key: 'data.totals.net', label: 'Net', align: 'end' }],
            `No pay runs yet. Use New in ${containers.runs.path}.`),
        ]),
      },
    },
  }
}

function structuresPage() {
  return {
    file: 'structures.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'payroll-structures', name: 'Salary structures', description: 'Salary structures and pay profiles.', icon: 'layers' },
      spec: {
        access: [
          { path: containers.structures.path, reason: 'List salary structures' },
          { path: containers.profiles.path, reason: 'List pay profiles' },
        ],
        data: {
          structures: folder(containers.structures.path, mimeTypes.structure),
          profiles: folder(containers.profiles.path, mimeTypes.profile),
        },
        tree: page([
          pageHeader(
            [heading('Salary structures'), text('Structures hold the pay rules — earnings, deductions and employer contributions as fixed amounts or percentages of the base wage. No tax tables are built in; rules are your data.', 'muted')], [
            button('Payroll', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-check'),
          ]),
          stats([
            stat('Structures', count('structures'), 'layers', loading('structures')),
            stat('Pay profiles', count('profiles'), 'id-card', loading('profiles')),
            stat('Active profiles', count('profiles', 'e.data.active === true'), 'user-check', loading('profiles')),
          ], 3),
          status('structures', `The ${containers.structures.path} folder could not be read. Reinstall Payroll to recreate it.`)[0],
          status('profiles', `The ${containers.profiles.path} folder could not be read. Reinstall Payroll to recreate it.`)[0],
          tabs([
            { value: 'structures', label: 'Structures', icon: 'layers' },
            { value: 'profiles', label: 'Pay profiles', icon: 'id-card' },
          ], [
            panel('structures', [row([button(`Open ${containers.structures.path}`, [openFile(containers.structures.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.structures.path, mimeTypes.structure,
                [{ key: 'name', label: 'Code' }, { key: 'data.name', label: 'Name' }],
                `No salary structures yet. Use New in ${containers.structures.path}.`)]),
            panel('profiles', [row([button(`Open ${containers.profiles.path}`, [openFile(containers.profiles.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.profiles.path, mimeTypes.profile,
                [{ key: 'name', label: 'Code' }, { key: 'data.employeeName', label: 'Employee' }, { key: 'data.baseWage', label: 'Base wage', align: 'end' }, { key: 'data.currency', label: 'Currency' }],
                `No pay profiles yet. Use New in ${containers.profiles.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), structuresPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
