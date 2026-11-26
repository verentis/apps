import { views } from './views.mjs'
import {
  apiVersion, baseActions, boundForm, button, card, formControl, heading, openFile, page, projectRegistration,
  row, scriptAction, stat, stats, status, table, text, appNavigation, appOperationsSource, offers, listPage,
} from '../../../tools/file-apps/canvas.mjs'
import { matters, mime, root, schema } from './contracts.mjs'

const warning = 'Matter files are visible to everyone who can read /legal-matters. Keep matters for different teams apart with workspace or folder permissions.'
const input = (key,label,extra = {}) => ({ key,label,...extra })
const choices = (key,label,values) => input(key,label,{ type: 'select', options: values.map(value => ({ label: value, value })) })
const rows = (key,label,fields,defaultRow,maximum = 100) => input(key,label,{ type: 'rows', fields,defaultRow,maximum })
const intakeLocked = "form.values.status === 'open' || form.values.status === 'declined'"
const billLocked = "form.values.status !== 'open' || !!form.values.prebill"
const clean = 'form.saving || form.dirty || form.invalid'
const b = (label,op,visible) => button(label,op,{ visible, disabled: clean })
const controls = (fields,lock) => fields.map(f => formControl(f,lock))
const openWhen = op => scriptAction(`${root}/scripts/workflow`, op, { parameters:{revision:'{{ form.values.revision }}'}, confirm: {
  title: ({ screen: 'Screen parties', decide: 'Record human decision', prepare: 'Prepare pre-bill', discard: 'Discard preview', approve: 'Approve or resume invoice draft' })[op],
  message: ({ screen: 'Compare against all matters, including archived files?', decide: 'Record this named reviewer’s disposition and freeze the engagement terms?',
    prepare: 'Resolve saved source records and agreed rates for review?', discard: 'Discard the unapproved preview without allocating charges?',
    approve: 'Reserve these sources and create one ordinary draft in Invoicing? Only released narratives leave the pre-bill.' })[op],
} })
// Where the matter stands of the seven steps: intake, screen, decision, open, WIP, pre-bill, draft invoice.
const stage = "(form.values.invoices || []).length > 0 ? 'invoice' : form.values.prebill ? 'prebill' : (form.values.charges || []).length > 0 ? 'wip' : form.values.status === 'open' ? 'open' : form.values.status === 'declined' ? 'declined' : form.values.status === 'screened' ? (form.values.disposition && form.values.disposition !== 'undecided' ? 'decision' : 'screen') : 'intake'"
const progress = {
  type: 'canvas.status-steps',
  props: {
    value: `{{ ${stage} }}`,
    steps: [
      { value: 'intake', label: 'Intake' }, { value: 'screen', label: 'Screen' }, { value: 'decision', label: 'Decision' },
      { value: 'open', label: 'Open' }, { value: 'wip', label: 'WIP' }, { value: 'prebill', label: 'Pre-bill' }, { value: 'invoice', label: 'Draft invoice' },
    ],
    branches: [{ value: 'declined', label: 'Declined' }],
  },
}
// Unbilled work at a glance: sources picked for the next invoice, and drafts made so far.
const wipSummary = { ...stats([
  stat('Sources for the next invoice', '{{ (form.values.charges || []).length }}', 'clock'),
  stat('Pre-bill', "{{ (form.values.prebill && form.values.prebill.stage) || 'Not prepared' }}", 'receipt-text'),
  stat('Invoice drafts', '{{ (form.values.invoices || []).length }}', 'file-text'),
], 3), rules: { visible: "form.values.status === 'open'" } }
const sections = [
  card('Instruction and parties', controls([
    input('title','Instruction'), rows('parties','Parties and aliases',[
      choices('role','Role',['client','counterparty','related']),input('name','Party name'),input('crm','CRM path (/customers/…)'),input('aliases','Aliases; separate with semicolons'),
    ],{ role:'client', name:'', crm:'', aliases:'' }),
    input('project','Dedicated Project record (/projects/…)'), input('engagement','Agreed scope, exclusions and billing terms',{type:'textarea'}),
    input('currency','Agreed currency'),input('fixedFee','Agreed one-off fixed fee (optional)'),
    rows('rates','Hourly rates by fee earner and effective date',[input('employee','Timesheets employee'),input('effective','From (YYYY-MM-DD)'),input('amount','Hourly rate')],
      {employee:'',effective:'',amount:''}),
  ],intakeLocked)),
  card('Human conflict review', [
    text('Potential matches: {{ form.values.screen ? form.values.screen.count : "not screened" }}. Check CRM, aliases and external records yourself. A zero count is not a clearance.'),
    ...controls([input('reviewBy','Reviewer (recorded name)'),choices('disposition','Disposition',['undecided','clear','waiver-reviewed','decline']),
      input('reviewReason','Decision, checks performed and waiver evidence',{type:'textarea'})],intakeLocked),
    row([b('Screen / re-screen','screen',`!(${intakeLocked})`),b('Record decision','decide',"form.values.status === 'screened'")]),
  ]),
  card('Matter activity', controls([
    input('team','Team (informational, not access control)',{type:'text-list'}),
    rows('links','Documents, project tasks and manually verified deadlines',[
      choices('kind','Type',['document','task','deadline']),input('description','Description'),input('path','Workspace path'),input('date','Date (YYYY-MM-DD)'),
    ],{kind:'task',description:'',path:'',date:''},200),
  ],"form.values.status === 'declined' || !!form.values.prebill")),
  card('Work in progress', [
    text('Use a validated time entry for this project, an approved single-line matter expense report, or the agreed fixed fee. Reimbursement alone does not establish client recoverability.'),
    ...controls([input('billingReviewer','Pre-bill approver (recorded name)'),rows('charges','Sources for the next invoice',[
      choices('source','Charge',['time','recoverable-expense','fixed-fee']),input('path','Source (blank for fixed fee)',{ type: 'select', options: '{{ data.sourceoptions }}' }),
      input('release','Narrative approved for the client'), input('writeDown','Write-down amount'),input('reason','Internal write-down reason'),
      input('recoverability','Expense: why this client owes the disbursement'),
    ],{source:'time',path:'',release:'',writeDown:'',reason:'',recoverability:''})],billLocked),
    b('Prepare pre-bill','prepare',`!(${billLocked})`),
  ]),
  card('Pre-bill review', [
    text('Currency: {{ form.values.currency }} · Stage: {{ (form.values.prebill && form.values.prebill.stage) || "not prepared" }}. Amounts below are before tax.'),
    table('{{ ((form.values.prebill && form.values.prebill.quote.rows) || []).map(r => ({ path:r.path, quantity:r.quantity, rate:r.rate, gross:r.total, reduction:r.writeDown, reason:r.reason, net:r.net, release:r.line.description, tax:r.line.taxRate })) }}',
      [['path','Internal source'],['quantity','Qty'],['rate','Rate'],['gross','Before adjustment'],['reduction','Write-down'],['reason','Reason'],['net','Invoice net'],['tax','Tax %'],['release','Client narrative']], 'No pre-bill'),
    row([b('Discard','discard',"form.values.prebill && form.values.prebill.stage === 'review'"), b('Approve / resume draft','approve','!!form.values.prebill')]),
    { ...text('Install Invoicing to turn an approved pre-bill into a draft invoice.'), rules: { visible: `form.values.prebill && form.values.prebill.stage === 'pending' && !(${offers('invoicing','create-draft-invoice')})` } },
    table('{{ (form.values.invoices || []).map(path => ({ path })) }}',[['path','Invoice in Invoicing']],'No drafts created',true),
  ]),
  card('Chronology',[table('{{ (form.values.chronology || []).map(event => ({ event })) }}',[['event','Event']],'No decisions recorded')]),
]
const form = boundForm({
  name:'legal-matters-matter',displayName:'Legal matter',description:'Matter intake, conflict decision and pre-bill.',icon:'briefcase-business',
  mime, schemaId:schema.$id, schemaSource:`${root}/schemas/matter.schema.json`,
  access:[{path:`${root}/`,reason:'Read the matter schema and run the guarded workflow'},
    {path:'/timesheets',reason:'Offer this matter’s validated time as charges'},{path:'/expense-reports',reason:'Offer approved expense reports as recoverable expenses'}],
  data:{
    ...appOperationsSource,
    timeentries:{ kind:'folder', path:'/timesheets', contents:true, 'mime-pattern':'application/vnd.verentis.timesheets.entry+json' },
    expensereports:{ kind:'folder', path:'/expense-reports', contents:true, 'mime-pattern':'application/vnd.verentis.expenses.report+json' },
    // What the workflow accepts: validated time on this matter's project, and approved or posted expense reports.
    sourceoptions:{ kind:'computed', expr:"(data.timeentries || []).filter(e => e.kind === 'file' && e.data && e.data.status === 'validated' && !!form.values.project && e.data.project === form.values.project).map(e => ({ value: e.path, label: 'Time · ' + (e.data.date || '') + ' · ' + (e.data.employee || '') + ' · ' + (e.data.hours || '') + ' h' })).concat((data.expensereports || []).filter(e => e.kind === 'file' && e.data && ['approved', 'posted'].includes(e.data.status)).map(e => ({ value: e.path, label: 'Expense · ' + (e.data.code || e.name) + ' · ' + (e.data.employeeName || '') + ' · ' + (e.data.total || '') })))" },
  },
  tree:[heading('Matter · {{ form.values.title || form.values.status }}'),progress,wipSummary,text(warning),text('{{ ctx.file.path }}'),
    row([button('Save changes','save',{disabled:'!form.dirty || form.invalid || form.saving'}),button('Reset unsaved changes','reset',{disabled:'!form.dirty'})]),
    ...status('record'),...sections],
  actions:{save:{permissions:['execution.run','execution.read'],steps:[
    {'run-script':{file:`${root}/scripts/workflow`,parameters:{operation:'save',path:'{{ ctx.file.path }}',revision:'{{ form.values.revision }}',values:'{{ form.values }}'}}},
    {'reset-form':{}},{'refresh-source':{source:'record'}},{toast:{message:'Saved matter',variant:'success'}},
  ]},reset:baseActions.reset,...Object.fromEntries(['screen','decide','prepare','discard'].map(op=>[op,openWhen(op)])),
    // Approving reserves the sources; Invoicing drafts the invoice through its API (keyed by the pre-bill), then the
    // workflow records it against the matter's new revision. Without Invoicing the pre-bill waits, approved.
    approve:openWhen('approve')},
})
// The design's Intake and Billing lists: matters before their conflict decision, and open matters' unbilled work.
const intake = listPage({ file: 'intake.page.yaml', id: 'legal-matters-intake', name: 'Intake', description: 'New matters before screening and the conflict decision.', icon: 'inbox',
  container: matters, mime,
  rows: "RECORDS.filter(e => e.data.status === 'intake' || e.data.status === 'screened').map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', parties: (e.data.parties || []).length,"
    + " screened: e.data.screen && e.data.screen.at ? e.data.screen.count + ' possible conflicts' : 'Not screened', status: e.data.status }))",
  columns: [['code', 'Matter'], ['title', 'Title'], ['parties', 'Parties', 'end'], ['screened', 'Screen'], ['status', 'Status', undefined, 'badge']],
  empty: 'No matter is waiting for intake or a conflict decision.' })
const billing = listPage({ file: 'billing.page.yaml', id: 'legal-matters-billing', name: 'Billing', description: 'Unbilled work per open matter, its pre-bill and the invoice drafts made so far.', icon: 'receipt-text',
  container: matters, mime,
  rows: "RECORDS.filter(e => e.data.status === 'open').map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', sources: (e.data.charges || []).length,"
    + " prebill: (e.data.prebill && e.data.prebill.stage) || 'Not prepared', drafts: (e.data.invoices || []).length, reviewer: e.data.billingReviewer || '' }))",
  columns: [['code', 'Matter'], ['title', 'Title'], ['sources', 'Unbilled sources', 'end'], ['prebill', 'Pre-bill', undefined, 'badge'], ['drafts', 'Invoice drafts', 'end'], ['reviewer', 'Billing reviewer']],
  empty: 'No open matters.' })

export const pages = appNavigation({
  'matter.form.yaml':projectRegistration(form,`${root}/canvas/matter.form.yaml`),
  'intake.page.yaml':projectRegistration(intake.document,`${root}/canvas/intake.page.yaml`),
  'billing.page.yaml':projectRegistration(billing.document,`${root}/canvas/billing.page.yaml`),
  'home.page.yaml':{'api-version':apiVersion,kind:'Page',metadata:{id:'legal-matters-home',name:'Legal Matters',icon:'briefcase-business'},
    spec:{tree:page([heading('Legal Matters'),text(warning),
      card('Start an instruction',[text('In Files choose New → Legal matter inside /legal-matters. The new matter opens for intake and conflict screening.'),
        button('Open intake folder in Files',[openFile(matters)],undefined,'outline','folder-open')]),
      card('From instruction to invoice',[text('Link CRM parties, screen, record a human conflict disposition and agree terms. Prepare a pre-bill from validated time and explicitly recoverable expenses; review before creating an Invoicing draft. No trust money.')]),
    ])}},
}, root, views)
