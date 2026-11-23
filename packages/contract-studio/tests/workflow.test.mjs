import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { run } from '../scripts/draft/main.mjs'
import { authority, catalog, contracts, digest, packs, precedents } from '../scripts/draft/model.mjs'
import { issue } from '../scripts/issue/main.mjs'
import { publish } from '../scripts/library/main.mjs'

const now = '2026-11-23T10:00:00Z'
const statute = { id:'ZA:test:s1',jurisdiction:'ZA',instrument:'Example Instrument',provision:'s 1',citation:'Example s 1',
  sourceUrl:'https://example.org/source',revision:'r1',coverage:'Reference only',rights:'link-only',text:'UNCLEARED SOURCE BODY' }
const clause = { code:'CONF',revision:1,title:'Confidentiality',wording:'{{client}} will protect information.',jurisdiction:'ZA',
  intendedUse:'Synthetic example',approvedBy:'Library reviewer',confirmed:true }
async function fixture(initial = {}) {
  const files = memoryFiles(initial)
  files.readText = async path => files.nodes.get(path)?.content
  const { path } = await run({operation:'create', code:'AGR-1',title:'Services agreement',matter:'/legal-matters/MAT-0001'},files,now)
  const doc = () => files.json(path)
  const step = (operation,fields = {}) => run({operation,path,version:doc().version,...fields},files,now)
  return { files,path,doc,step }
}

test('approval pins ordered rendered wording, separate internal provenance and all artifact digests', async () => {
  const {files,path,step,doc} = await fixture({[`${packs}/ZA`]:{ authorities:[statute] }})
  const {path:precedentPath} = await publish(clause,files,now)
  await step('add-inline',{pointId:'delivery',wording:'Deliver after point {{point:secrecy}}.'})
  await step('add-firm',{pointId:'secrecy',precedentPath,bindings:'client=Example Ltd'})
  await step('edit-point',{pointId:'secrecy',wording:'{{client}} keeps records secure.',bindings:'client=Example Ltd',note:'Negotiation floor: private'})
  await step('attach',{pointId:'secrecy',catalog,authorityId:statute.id,pinpoint:'s 1(2)'})
  await step('move',{pointId:'secrecy',position:1})
  assert.equal(files.json(precedentPath).wording,clause.wording)
  await step('submit')
  assert.equal(doc().review.client,'Services agreement\n\n1. Example Ltd keeps records secure.\n\n2. Deliver after point 1.\n')
  await assert.rejects(step('edit-point',{pointId:'secrecy'}), /Return this agreement/)
  await step('approve',{reviewer:'Review lawyer'})
  await assert.rejects(step('return'),/frozen/)
  const frozen = doc().snapshot
  await files.write(`${packs}/ZA`, JSON.stringify({authorities:[]}))
  await publish({...clause,revision:2,wording:'Changed after approval'},files,now)
  const out = await issue({path,version:doc().version},files)
  assert.equal(doc().stage,'issued')
  assert.equal(await files.readText(out.client),frozen.client)
  assert.equal(digest(await files.readText(out.client)),frozen.clientSha256)
  assert.equal(digest(await files.readText(out.office)),frozen.officeSha256)
  assert.equal((await files.stat(out.office)).contentType,'application/vnd.oasis.opendocument.text-flat-xml')
  assert.equal(digest(await files.readText(out.schedule)),frozen.scheduleSha256)
  const schedule = files.json(out.schedule)
  assert.equal(schedule.points[0].precedent.revision,1)
  assert.equal(schedule.points[0].precedent.wording,clause.wording)
  assert.equal(schedule.points[0].localVariation,true)
  assert.deepEqual(schedule.points[0].bindings,{client:'Example Ltd'})
  assert.equal(schedule.points[0].citation.revision,'r1')
  assert.equal(schedule.points[0].citation.pinpoint,'s 1(2)')
  assert.equal(schedule.points[0].internalNote,'Negotiation floor: private')
  assert.equal(schedule.officeSha256,frozen.officeSha256)
  assert.doesNotMatch(frozen.office,/Negotiation|Example s 1|reviewer|UNCLEARED|MAT-0001/)
  assert.doesNotMatch(frozen.client,/Negotiation|Example s 1|reviewer|UNCLEARED|MAT-0001/)
  assert.doesNotMatch(JSON.stringify(doc()),/UNCLEARED/)
  files.nodes.delete(out.client)
  files.nodes.delete(out.office)
  await issue({path,version:doc().version},files)
  assert.equal(await files.readText(out.client),frozen.client)
  assert.equal(await files.readText(out.office),frozen.office)
  assert.deepEqual(doc().snapshot,frozen)
})

test('Office export represents plain content as XML data and preserves tabs, spaces and paragraph breaks', async () => {
  const {step,doc} = await fixture()
  await step('add-inline',{pointId:'x',wording:'</text:p> & 🖊\r\n  Second\tline  here.'})
  await step('submit')
  await step('approve',{reviewer:'S'})
  const {client,office} = doc().snapshot
  assert.ok(client.includes('1. </text:p> & 🖊\n  Second\tline  here.'))
  assert.ok(office.includes('<text:p>1. &lt;/text:p&gt; &amp; 🖊</text:p>\n<text:p><text:s text:c="2"/>Second<text:tab/>line<text:s text:c="2"/>here.</text:p>'))
  const invalid = await fixture()
  await invalid.step('add-inline',{pointId:'bad',wording:'Invalid\u0000 XML'})
  await assert.rejects(invalid.step('submit'),/character not permitted/)
})

test('review validates references, bindings, non-empty content and workflow ordering without a law pack',async () => {
  const {step,doc,files,path} = await fixture()
  await assert.rejects(issue({path,version:1},files),/Only approved/)
  await assert.rejects(step('submit'),/1–100/)
  await step('add-inline',{pointId:'pay',wording:'{{buyer}} pays under point {{point:terms}}.'})
  await assert.rejects(step('add-inline',{pointId:'pay',wording:'Duplicate'}),/new point ID/)
  await assert.rejects(step('submit'),/Unresolved variable/)
  await step('edit-point',{pointId:'pay',wording:doc().points[0].wording,bindings:'buyer=XYZ'})
  await assert.rejects(step('submit'),/Broken point reference/)
  await step('add-inline',{pointId:'terms',wording:'Agreed terms.'})
  await step('submit')
  await assert.rejects(step('approve',{reviewer:'  '}),/reviewer/)
  await step('return')
  await step('remove',{pointId:'terms'})
  await assert.rejects(step('submit'),/Broken point reference/)
})

test('each draft mutation requires a matching viewed version and strong conditional write',async () => {
  const {step,files,path,doc} = await fixture()
  await step('add-inline',{pointId:'a',wording:'First user'})
  await assert.rejects(step('remove',{pointId:'a',version:1}),/changed/)
  const write = files.write.bind(files)
  files.write = async (p,s,opts) => { files.touch(p); return write(p,s,opts) }
  await assert.rejects(step('remove',{pointId:'a'}),e => e.statusCode===412)
  files.stat = async () => ({etag:null})
  await assert.rejects(step('remove',{pointId:'a'}),/ETag/)
  assert.equal(doc().points[0].wording,'First user')
  assert.equal(files.json(path).version,2)
})

test('precedents are cleared create-only; source decisions require the reviewed diff and preserve local wording',async () => {
  const {step,files,doc} = await fixture()
  await assert.rejects(publish({...clause,confirmed:false},files,now),/clearance|Confirm/)
  const one = await publish(clause,files,now)
  await assert.rejects(publish({...clause,wording:'Rewrite'},files,now),e=>e.statusCode===412)
  const two = await publish({...clause,revision:2,wording:'Later approved base.'},files,now)
  await step('add-firm',{pointId:'clause',precedentPath:one.path})
  await step('edit-point',{pointId:'clause',wording:'Local override.'})
  const request = {pointId:'clause',sourceKind:'firm',precedentPath:two.path}
  const preview = await step('compare',request)
  assert.match(preview.before,/will protect/)
  assert.match(preview.after,/Later approved/)
  await step('decide',{...request,token:preview.token,decision:'defer'})
  assert.equal(doc().points[0].precedent.revision,1)
  await assert.rejects(step('decide',{...request,token:preview.token,decision:'accept'}),/Preview/)
  await step('decide',{...request,token:(await step('compare',request)).token,decision:'accept'})
  assert.equal(doc().points[0].precedent.revision,2)
  assert.equal(doc().points[0].variation,'Local override.')
})

test('additional pack citations validate rights, projected metadata and changed revisions before adoption',async () => {
  const pack = `${packs}/NA`
  const {step,doc,files} = await fixture({[pack]:{authorities:[{...statute,jurisdiction:'NA'}]}})
  await step('add-inline',{pointId:'a',wording:'Our own language.'})
  const args = {pointId:'a',catalog:pack,authorityId:statute.id,pinpoint:'section 1'}
  await step('attach',args)
  assert.equal(doc().points[0].authority.jurisdiction,'NA')
  await files.write(pack,JSON.stringify({authorities:[{...statute,jurisdiction:'NA',revision:'r2'}]}))
  const update = {pointId:'a',sourceKind:'authority'}
  const preview = await step('compare',update)
  assert.doesNotMatch(preview.after,/UNCLEARED/)
  await step('decide',{...update,decision:'reject',token:preview.token})
  assert.equal(doc().points[0].authority.revision,'r1')
  await step('decide',{...update,decision:'accept',token:(await step('compare',update)).token})
  assert.equal(doc().points[0].authority.revision,'r2')
  await files.write(pack,JSON.stringify({authorities:[{...statute,rights:'unknown'}]}))
  await assert.rejects(step('attach',args),/link-only/)
  assert.throws(()=>authority({...statute,sourceUrl:'file:///private'}),/HTTPS/)
  await assert.rejects(step('attach',{...args,catalog:`${packs}/../private`}),/Invalid/)
  await assert.rejects(step('add-firm',{pointId:'b',precedentPath:`${precedents}/../bad`}),/Invalid/)
  await assert.rejects(run({operation:'remove',path:`${contracts}/%2e%2e/secret`},files,now),/Invalid/)
})

test('an interrupted issue resumes from identical bytes; a conflicting client file is never overwritten',async () => {
  const {step,files,path,doc} = await fixture()
  await step('add-inline',{pointId:'one',wording:'Synthetic agreement.'})
  await step('submit')
  await step('approve',{reviewer:'R'})
  const opts = {path,version:doc().version}
  const write = files.write.bind(files)
  files.write = async (p,...rest) => { if (p.endsWith('.txt')) throw new Error('Temporary error'); return write(p,...rest) }
  await assert.rejects(issue(opts,files),/Temporary error/)
  assert.equal(doc().stage,'approved')
  files.write = write
  const client = '/legal-client-documents/AGR-1.txt'
  await files.write(client,'A different file')
  await assert.rejects(issue(opts,files),/Conflicting artifact/)
  assert.equal(await files.readText(client),'A different file')
  files.nodes.delete(client)
  await issue(opts,files)
  const count = files.writes.length
  await issue({path,version:doc().version},files)
  assert.equal(files.writes.length,count)
})
