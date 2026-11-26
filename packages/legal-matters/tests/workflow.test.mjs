import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { lineTotals } from '../../invoicing/scripts/post/main.mjs'
import { run, runWithApps } from '../scripts/workflow/main.mjs'
import { createDraftInvoice } from '../../invoicing/scripts/api/main.mjs'
import { pages } from '../src/pages.mjs'

const workspace = randomUUID(), reg = '/legal-billing-register', project = '/projects/P-1', client = '/customers/C-1'
const time = '/timesheets/T-1', expense = '/expense-reports/E-1'
const charge = (source,path,release,extra={}) => ({source,path,release,writeDown:'',reason:'',recoverability:'',...extra})
function fixture() {
  const settings = {}
  const files = memoryFiles({
    [reg]:{version:1,batches:[]}, [client]:{kind:'company',state:'active',name:'Example Ltd'},[project]:{kind:'project',state:'active'},
    '/settings/invoicing.json':{defaultDueDays:14, defaultTaxRate:'15'},'/settings/accounting.json':{baseCurrency:'ZAR',minorDigits:2},
    [time]:{kind:'entry',id:randomUUID(),state:'active',status:'validated',employee:'Taylor',date:'2026-06-01',validatedAt:'2026-06-02',hours:'1.25',project,description:'PRIVATE'},
    [expense]:{kind:'report',id:randomUUID(),state:'active',status:'approved',approvedAt:'2026-06-02',approver:'Finance',
      total:'10.50',lines:[{amount:'10.50',date:'2026-06-01',description:'PRIVATE'}]},
  })
  const call = (p,ctx={}) => run({context:{workspace:{id:workspace},input:{parameters:p},...ctx},files,settings:{get:k=>settings[k]}})
  const op = (path,operation,extra={}) => call({path,operation,revision:files.json(path).revision,...extra})
  const edit = (path,fields) => op(path,'save',{values:{...files.json(path),...fields}})
  const create = () => call({parentPath:'/legal-matters',operation:'create',creatable:'matter',template:'ignore me'})
  const intake = async () => {
    const {path} = await create()
    await edit(path,{title:'Synthetic services',parties:[{role:'client',name:'Example',crm:client,aliases:'Example Incorporated'}],project,
      engagement:'Commercial advisory only',rates:[{employee:'Taylor',effective:'2025-01-01',amount:'75'},{employee:'Taylor',effective:'2026-01-01',amount:'100'}],fixedFee:'60'})
    await op(path,'screen')
    return path
  }
  const open = async () => {
    const path = await intake()
    await edit(path,{reviewBy:'Reviewer',reviewReason:'Reviewed other matters and external sources',disposition:files.json(path).screen.count ? 'waiver-reviewed' : 'clear'})
    await op(path,'decide')
    return path
  }
  const prepare = async (path,charges) => { await edit(path,{billingReviewer:'Billing reviewer',charges}); await op(path,'prepare') }
  // Approve in one workflow run: it reserves the sources, has Invoicing draft the invoice through the platform (here
  // Invoicing's real operation against the same files) and records the draft against the new revision.
  const invoicing = {call:async (app,operation,input) => ({result:await createDraftInvoice(input,{files,settings:{get:()=>undefined},caller:{app:'legal-matters'},now:new Date().toISOString()})})}
  const approve = (path,apps=invoicing) => runWithApps({context:{workspace:{id:workspace},input:{parameters:{path,operation:'approve',revision:files.json(path).revision}}},files,settings:{get:k=>settings[k]},apps})
  return {call,op,edit,create,intake,open,prepare,approve,files,settings,invoicing}
}

test('runs without any pilot setting; other branches, other folders and indirect paths fail before any file access', async () => {
  const f = fixture(), p = {operation:'create',parentPath:'/legal-matters',creatable:'matter'}
  for (const key of Object.keys(f.settings)) delete f.settings[key]
  await assert.rejects(f.call(p,{file:{branch:'other'}}),/main branch only/)
  await assert.rejects(f.call({...p,parentPath:'/customers'}),/only inside/)
  await assert.rejects(f.call({operation:'decide',path:'/legal-matters/../customers/C-1'}),/direct record/)
  assert.deepEqual(f.files.writes,[])
  const {path} = await f.create()
  assert.equal(f.files.json(path).title,'New matter')
  assert.equal(f.files.json(path).pilot,undefined)
  assert(!JSON.stringify(pages['matter.form.yaml'].spec.actions).includes('"save":{}'))
})

test('the launch page lists every matter; matters created during the pilot still load', async () => {
  const home = pages['home.page.yaml']
  assert.equal(home.spec.data.matters.path,'/legal-matters')
  assert.match(JSON.stringify(home.spec.tree),/canvas\.board/)
  const f = fixture()
  const path = await f.intake()
  // A matter written during the pilot carries the old marker; it still screens and saves.
  await f.files.write(path, JSON.stringify({...f.files.json(path),pilot:'synthetic-only'}), {contentType:'application/vnd.verentis.legal-matters.matter+json'})
  await f.op(path,'screen')
  assert.equal(f.files.json(path).pilot,'synthetic-only')
})

test('screen includes adverse aliases and requires fresh human disposition; guarded saves reject stale editors',async()=>{
  const f=fixture(), a=await f.open(), b=await f.intake()
  const previous=f.files.json(b).revision
  await f.files.write('/customers/C-2',JSON.stringify({kind:'contact',state:'active',givenName:'Unrelated'}))
  await f.edit(b,{parties:[{role:'client',name:'Unrelated',crm:'/customers/C-2',aliases:''},{role:'counterparty',name:'Example Incorporated',crm:'',aliases:''}],
    disposition:'clear',reviewBy:'Lawyer',reviewReason:'Reviewed'})
  await assert.rejects(f.op(b,'decide'),/Screen again/)
  await assert.rejects(f.call({path:b,operation:'save',revision:previous,values:f.files.json(b)}),/changed since/)
  await f.op(b,'screen')
  assert.equal(f.files.json(b).screen.count,1)
  await f.edit(b,{disposition:'clear',reviewBy:'Lawyer',reviewReason:'Reviewed'})
  await assert.rejects(f.op(b,'decide'),/waiver review/)
  await f.edit(b,{disposition:'decline'})
  await f.op(b,'decide')
  await assert.rejects(f.op(b,'prepare'),/opened matter/)
  await f.edit(a,{status:'intake',project:'/projects/other',prebill:{stage:'pending'}})
  assert.equal(f.files.json(a).project,project)
  assert.equal(f.files.json(a).prebill,undefined)
})

test('an incomplete listing is not a clean conflicts screen',async()=>{
  const f=fixture(),path=await f.intake()
  f.files.list=async()=>({children:null})
  await assert.rejects(f.op(path,'screen'),/cannot complete/)
})

test('preview resolves exact agreed rates, write-downs and separate recoverability, releases only safe invoice fields',async()=>{
  const f=fixture(), path=await f.open()
  await f.prepare(path,[charge('time',time,'Professional services',{writeDown:'5.00',reason:'PRIVATE concession'}),
    charge('recoverable-expense',expense,'Filing expense',{recoverability:'PRIVATE engagement clause'}),charge('fixed-fee','','Agreed fixed fee')])
  const q=f.files.json(path).prebill.quote
  assert.deepEqual(q.rows.map(x=>[x.quantity,x.rate,x.net]),[['1.25','100','120.00'],['1','10.50','10.50'],['1','60','60.00']])
  const {path:ip}=await f.approve(path), draft=f.files.json(ip)
  assert.equal(draft.source.app,'legal-matters')
  assert.equal(draft.status,'draft')
  assert.equal(draft.customerRef,client)
  assert.equal(draft.customer.name,'Example Ltd')
  assert.equal(lineTotals(draft.lines,2).net,19050n)
  // The source names the matter for Invoicing's own dedupe; nothing private reaches the customer-facing fields.
  const facing = {...draft, source: undefined}
  for (const term of ['PRIVATE','MAT-','/timesheets','/expense-reports','Taylor','Billing reviewer']) assert(!JSON.stringify(facing).includes(term))
  assert.equal(f.files.json(reg).batches.length,1)
  assert.deepEqual(f.files.json(path).invoices,[ip])
  await f.prepare(path,[charge('time',time,'Another narrative')])
  await assert.rejects(f.op(path,'approve'),/already reserved/)
  assert.equal(f.files.json(path).prebill,undefined)
})

test('billing rejects unrelated time, drafts, unsupported reimbursements and stale reviewed prices',async()=>{
  const f=fixture(),path=await f.open(),original=f.files.json(time)
  await f.edit(path,{charges:[charge('time',time,'Advisory')],billingReviewer:'Reviewer'})
  for(const bad of [{status:'draft'},{project:'/projects/other'},{employee:'Unknown'}]) {
    await f.files.write(time,JSON.stringify({...original,...bad}))
    await assert.rejects(f.op(path,'prepare'),/validated|agreed rate/)
  }
  await f.files.write(time,JSON.stringify(original))
  await f.edit(path,{charges:[charge('recoverable-expense',expense,'Expenditure')]})
  await assert.rejects(f.op(path,'prepare'),/recoverability/)
  await f.prepare(path,[charge('time',time,'Advisory')])
  f.files.touch(time)
  await assert.rejects(f.op(path,'approve'),/changed/)
  assert.equal(f.files.json(reg).batches.length,0)
  await f.op(path,'discard')
})

test('concurrent reviewers on different matters cannot invoice the same source; a lost answer resumes the same draft',async()=>{
  const f=fixture(),a=await f.open(),b=await f.open()
  for(const p of [a,b]) await f.prepare(p,[charge('time',time,'Approved advice')])
  const results=await Promise.allSettled([f.op(a,'approve'),f.op(b,'approve')])
  const batches=f.files.json(reg).batches
  assert.equal(batches.length,1)
  const winner=batches[0].matter===f.files.json(a).id?a:b, loser=winner===a?b:a
  assert.equal(f.files.json(winner).prebill.stage,'pending')
  // Invoicing drafted, but its answer never reached the form: approving again asks for the same draft.
  const first=results.find(r=>r.status==='fulfilled' && r.value.invoiceRequest).value
  await createDraftInvoice(first.invoiceRequest,{files:f.files,settings:{get:()=>undefined},caller:{app:'legal-matters'},now:new Date().toISOString()})
  await f.approve(winner)
  if(f.files.json(loser).prebill) await assert.rejects(f.op(loser,'approve'),/already reserved/)
  const invoices=f.files.writes.filter(p=>p.startsWith('/invoices/'))
  assert.equal(invoices.length,1)
  assert.deepEqual(f.files.json(winner).invoices,invoices)
  assert.deepEqual(f.files.json(loser).invoices,[])
  assert.equal(f.files.json(reg).batches[0].delivered,true)
})

test('missing ETags stop writes and missing allocation register stops invoice creation',async()=>{
  const f=fixture(),path=await f.open()
  await f.prepare(path,[charge('time',time,'Services')])
  f.files.nodes.delete(reg)
  await assert.rejects(f.op(path,'approve'),/does not exist/)
  assert.equal(f.files.writes.filter(x=>x.startsWith('/invoices/')).length,0)
  const stat=f.files.stat.bind(f.files)
  f.files.stat=async p=>({...await stat(p),etag:''})
  await assert.rejects(f.op(path,'approve'),/ETag/)
})

test('approving without Invoicing installed leaves the pre-bill approved and asks nothing else', async () => {
  const f=fixture(), path=await f.open()
  await f.prepare(path,[charge('fixed-fee','','Agreed fixed fee')])
  const missing={call:async () => { throw Object.assign(new Error('invoicing is not installed'),{code:'target_not_installed'}) }}
  const result=await f.approve(path,missing)
  assert.equal(result.invoiceRequest,undefined)
  assert.deepEqual(f.files.json(path).invoices,[])
  // Approved and waiting for its invoice: Approve again once Invoicing is installed.
  assert.equal(f.files.json(path).prebill.stage,'pending')
  assert.ok(f.files.json(path).prebill.approvedAt)
})
