import {
  apiVersion, baseActions, boundForm, button, card, formControl, heading, openFile, page, projectRegistration,
  row, scriptAction, status, table, text,
} from '../../../tools/file-apps/canvas.mjs'
import { matters, mime, root, schema } from './contracts.mjs'

const warning = 'Synthetic pilot only. Do not enter real names, client instructions or confidential records. Everyone in this isolated workspace must be authorised for every pilot file.'
const input = (key,label,extra = {}) => ({ key,label,...extra })
const choices = (key,label,values) => input(key,label,{ type: 'select', options: values.map(value => ({ label: value, value })) })
const rows = (key,label,fields,defaultRow,maximum = 100) => input(key,label,{ type: 'rows', fields,defaultRow,maximum })
const intakeLocked = "form.values.status === 'open' || form.values.status === 'declined'"
const billLocked = "form.values.status !== 'open' || !!form.values.prebill"
const clean = 'form.saving || form.dirty || form.invalid'
const b = (label,op,visible) => button(label,op,{ visible, disabled: clean })
const controls = (fields,lock) => fields.map(f => formControl(f,lock))
const openWhen = op => scriptAction(`${root}/scripts/workflow`, op, { parameters:{revision:'{{ form.values.revision }}'}, confirm: {
  title: ({ screen: 'Screen synthetic parties', decide: 'Record human decision', prepare: 'Prepare pre-bill', discard: 'Discard preview', approve: 'Approve or resume invoice draft' })[op],
  message: ({ screen: 'Compare all pilot matters, including archived files?', decide: 'Record this named reviewer’s disposition and freeze the engagement terms?',
    prepare: 'Resolve saved source records and agreed rates for review?', discard: 'Discard the unapproved preview without allocating charges?',
    approve: 'Reserve these sources and create one ordinary draft in Invoicing? Only released narratives leave the pre-bill.' })[op],
} })
const sections = [
  card('Instruction and parties', controls([
    input('title','Synthetic instruction'), rows('parties','Parties and aliases',[
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
      choices('source','Charge',['time','recoverable-expense','fixed-fee']),input('path','Source path (blank for fixed fee)'),
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
    table('{{ (form.values.invoices || []).map(path => ({ path })) }}',[['path','Invoice in Invoicing']],'No drafts created',true),
  ]),
  card('Chronology',[table('{{ (form.values.chronology || []).map(event => ({ event })) }}',[['event','Event']],'No decisions recorded')]),
]
const form = boundForm({
  name:'legal-matters-matter',displayName:'Synthetic legal matter',description:'Isolated pilot matter and pre-bill.',icon:'briefcase-business',
  mime, schemaId:schema.$id, schemaSource:`${root}/schemas/matter.schema.json`,
  access:[{path:`${root}/`,reason:'Read the matter schema and run the guarded workflow'}], data:{},
  tree:[heading('Matter · {{ form.values.status }}'),text(warning),text('{{ ctx.file.path }}'),
    row([button('Save changes','save',{disabled:'!form.dirty || form.invalid || form.saving'}),button('Reset unsaved changes','reset',{disabled:'!form.dirty'})]),
    ...status('record'),...sections],
  actions:{save:{permissions:['execution.run','execution.read'],steps:[
    {'run-script':{file:`${root}/scripts/workflow`,parameters:{operation:'save',path:'{{ ctx.file.path }}',revision:'{{ form.values.revision }}',values:'{{ form.values }}'}}},
    {'reset-form':{}},{'refresh-source':{source:'record'}},{toast:{message:'Saved synthetic matter',variant:'success'}},
  ]},reset:baseActions.reset,...Object.fromEntries(['screen','decide','prepare','discard','approve'].map(op=>[op,openWhen(op)]))},
})
export const pages = {
  'matter.form.yaml':projectRegistration(form,`${root}/canvas/matter.form.yaml`),
  'home.page.yaml':{'api-version':apiVersion,kind:'Page',metadata:{id:'legal-matters-home',name:'Legal Matters',icon:'briefcase-business'},
    spec:{tree:page([heading('Legal Matters'),text(warning),
      card('Start a synthetic instruction',[text('Disabled by default. The administrator must designate this isolated synthetic workspace before creating a matter. In Files choose New → Synthetic legal matter inside /legal-matters.'),
        button('Open intake folder in Files',[openFile(matters)],undefined,'outline','folder-open')]),
      card('From instruction to invoice',[text('Link CRM parties, screen, record a human conflict disposition and agree terms. Prepare a pre-bill from validated time and explicitly recoverable expenses; review before creating an Invoicing draft. No trust money.')]),
    ])}},
}
