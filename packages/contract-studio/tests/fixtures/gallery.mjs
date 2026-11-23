// Generate synthetic Canvas screenshot input using the same operations as the installed app.
import { memoryFiles } from '../../../../tools/file-apps/memory-files.mjs'
import { run } from '../../scripts/draft/main.mjs'
import { publish } from '../../scripts/library/main.mjs'
import { catalog } from '../../scripts/draft/model.mjs'

const when = '2026-11-23T09:30:00Z'
const authority = { id:'ZA:popia:s21',jurisdiction:'ZA',instrument:'Protection of Personal Information Act 4 of 2013',
  provision:'s 21',citation:'POPIA s 21',sourceUrl:'https://www.gov.za/documents/protection-personal-information-act',
  revision:'synthetic-demo',coverage:'Reference only',rights:'link-only' }
const files = memoryFiles({ [catalog]:{authorities:[authority]} })
const {path} = await run({ operation:'create',code:'AGR-0042',title:'Studio services agreement',matter:'/legal-matters/MAT-0018' },files,when)
const revise = (operation,fields={}) => run({operation,path,version:files.json(path).version,...fields},files,when)
const library = await publish({ code:'CONF',title:'Confidential records',revision:3,wording:'{{supplier}} will safeguard the records.',
  jurisdiction:'ZA',intendedUse:'Commercial services',approvedBy:'Demo counsel',confirmed:true },files,when)
await revise('add-inline',{pointId:'delivery',wording:'Deliver the first design within ten business days.'})
await revise('add-firm',{pointId:'records',precedentPath:library.path,bindings:'supplier=Example Studio'})
await revise('edit-point',{pointId:'records',wording:'{{supplier}} will safeguard the project records.',bindings:'supplier=Example Studio',note:'Commercial scope confirmed.'})
await revise('attach',{pointId:'records',authorityId:authority.id,pinpoint:'s 21(1)'})
await revise('submit')
console.log(JSON.stringify({ path, record:files.json(path), files:Object.fromEntries([...files.nodes.keys()].map(k=>[k,files.json(k)])) },null,2))
