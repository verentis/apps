import { readFile } from 'node:fs/promises'
import { generate, json, scriptConsent, scriptManifest } from '../../../tools/file-apps/build.mjs'
import { documentFileAccess } from '../../../tools/file-apps/canvas.mjs'
import { catalog, clients, contracts, mime, packs, precedents, root, schedules, schemaId } from '../scripts/draft/model.mjs'
import { pages } from './pages.mjs'

const id = 'contract-studio'
const name = 'Contract Studio'
const api = { 'api-version': 'verentis.io/v1', kind: 'Application' }
const canvas = 'https://canvas.apps.localtest.me'
const grant = (path, mode, reason) => ({ path, mode, reason })
const scripts = {
  draft: [grant(contracts,'write','Create and conditionally edit, submit and approve agreements'),
    grant(precedents,'read','Pin approved clause revisions'),grant(catalog,'read','Pin citation metadata only'),
    grant(packs,'read','Pin citation metadata from a selected additional jurisdiction pack')],
  library: [grant(precedents,'write','Publish cleared firm clause revisions create-only')],
  issue: [grant(contracts,'write','Read the approval snapshot and conditionally mark delivery complete'),
    grant(clients,'write','Materialise clean TXT and Office-editable FODT files create-only'),grant(schedules,'write','Materialise the separate internal source schedule create-only')],
}
const containers = { contracts, precedents, clients, schedules }
const manifest = { ...api,
  metadata: { id, name, description: 'Draft, review and issue agreements with traceable firm wording and citation metadata.',
    icon: './icons/app.svg', version:'0.1.0', author:'Verentis' },
  marketplace: { logo:'./icons/app.svg', hero:{source:'./marketplace/hero.svg',alt:'Contract Studio — agreements and source schedules'},
    images:[{source:'./marketplace/overview.png',alt:'Contract Studio home in Canvas',caption:'Start an agreement or publish a cleared firm revision.'},
      {source:'./marketplace/detail.png',alt:'Agreement review in Canvas',caption:'Review ordered points, source revisions and clean client wording.'}],
    readme:'./marketplace/README.md', keywords:['legal','contracts','drafting','precedents','citations'] },
  spec: {
    'install-root':root, entry:canvas, scope:'global', 'entry-points':[{id:'home','display-name':name,route:'/render?document=.%2Fcanvas%2Fhome.page.yaml',order:10}],
    launch:{ enabled:true, 'entry-point':'home', pinnable:true }, permissions:['file.read','file.write','execution.run','execution.read'],
    scopes:['contract-studio.default'], dependencies:[{package:'verentis/canvas',version:'latest'},{package:'verentis/nodejs',version:'latest'}],
    engine:'verentis/nodejs', scripts:Object.keys(scripts).map(k => `scripts/${k}`),
    install:[
      ...['form','page'].map(kind => ({from:`canvas/*.${kind}.yaml`,to:`${root}/canvas/`,mode:'managed',mime:`application/vnd.verentis.canvas.${kind}+yaml`})),
      {from:'schemas/*.schema.json',to:`${root}/schemas/`,mode:'managed',mime:'application/schema+json'},
      ...Object.entries(containers).map(([key,path]) => ({from:`seed/${key}`,to:path,mode:'seed',mime:`application/vnd.verentis.contract-studio.${key}`})),
    ],
    'file-access':[...documentFileAccess(pages),...Object.entries(scripts).flatMap(([k,g]) => scriptConsent(`${id}-${k}`,g))],
    sandbox:{'allow-scripts':true,'allow-same-origin':true,'allow-forms':true,'allow-popups':false},
  },
  packaging:{publisher:'verentis',files:['canvas/**','schemas/**','seed/**','scripts/**','icons/**','marketplace/**','README.md'],
    templates:['canvas/*.yaml'], variables:{'canvas-origin':canvas},encryption:'none'},
}
const overlay = entry => ({...api,metadata:{id},spec:{entry},packaging:{variables:{'canvas-origin':entry}}})
const model = await readFile(new URL('../scripts/draft/model.mjs', import.meta.url),'utf8')
const text = { type:'string' }
const schema = { $schema:'https://json-schema.org/draft/2020-12/schema', $id:schemaId, type:'object',title:'Contract Studio agreement',
  required:['kind','version','stage','code','title','points'],properties:{
    kind:{const:'contract'}, version:{type:'integer',minimum:1},stage:{enum:['draft','in-review','approved','issued']},
    code:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'},title:{type:'string',minLength:1,maxLength:200},matter:text,
    points:{type:'array',maxItems:100,items:{type:'object',required:['id','origin'],properties:{id:text,origin:{enum:['inline','firm']},wording:text,
      variation:text,bindings:text,note:text,precedent:{type:'object'},authority:{type:'object',required:['id','rights','pinpoint','sourceUrl','revision'],properties:{rights:{const:'link-only'}}}}}},
    snapshot:{type:'object',required:['client','office','schedule','clientSha256','officeSha256','scheduleSha256']},
  } }
await generate({ root:new URL('../',import.meta.url),label:name,directories:[], outputs:{
  [`${id}.app.yaml`]:json(manifest), 'environments/feature.yaml':json(overlay('https://canvas.${param:apps-domain}')),
  'environments/production.yaml':json(overlay('https://canvas.apps.verentis.io')),
  'schemas/contract.schema.json':json(schema),
  ...Object.fromEntries(Object.keys(containers).map(k => [`seed/${k}`,''])),
  ...Object.fromEntries(Object.entries(pages).map(([k,v]) => [`canvas/${k}`,json(v)])),
  ...Object.fromEntries(Object.entries(scripts).map(([k,g]) => [`scripts/${k}/manifest.yaml`,scriptManifest(`${id}-${k}`,g,`Scoped ${k} operation.`)])),
  ...Object.fromEntries(['library','issue'].map(k => [`scripts/${k}/model.mjs`,`// Generated from scripts/draft/model.mjs by src/build.mjs.\n${model}`])),
} })
