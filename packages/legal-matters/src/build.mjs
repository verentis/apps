import { generate, json, scriptConsent, scriptManifest, sharedSource } from '../../../tools/file-apps/build.mjs'
import { documentFileAccess } from '../../../tools/file-apps/canvas.mjs'
import { folderMime, matters, mime, register, root, schema, template } from './contracts.mjs'
import { pages } from './pages.mjs'

const id = 'legal-matters', script = `${id}-workflow`
const local = 'https://canvas.apps.localtest.me'
const access = [
  [matters,'write','Create, screen and update synthetic pilot matters'],
  [register,'write','Conditionally reserve sources and track invoice delivery'],
  ['/customers','read','Validate named CRM party links'],
  ['/projects','read','Validate the linked project'],
  ['/timesheets','read','Read selected validated time'],
  ['/expense-reports','read','Read selected approved disbursements'],
  ['/settings/accounting.json','read','Check currency and precision'],
  ['/settings/invoicing.json','read','Read payment terms and tax defaults'],
  ['/invoices','write','Create ordinary draft invoices without overwriting them'],
].map(([path,mode,reason])=>({path,mode,reason}))
const manifest = {
  'api-version':'verentis.io/v1',kind:'Application',
  metadata:{id,name:'Legal Matters',description:'Synthetic matter intake, human conflict review and traceable pre-billing.',icon:'./icons/app.svg',version:'0.1.0',author:'Verentis'},
  marketplace:{logo:'./icons/app.svg',readme:'./marketplace/README.md',keywords:['legal','matters','conflicts','billing'],
    hero:{source:'./marketplace/hero.svg',alt:'Legal Matters · practice workspace'},
    images:[
      {source:'./marketplace/overview.png',alt:'Synthetic-only Legal Matters launch page',caption:'Open the isolated pilot intake folder'},
      {source:'./marketplace/detail.png',alt:'Synthetic instruction and human conflict review in Canvas',caption:'Review linked parties and agreed terms'},
    ]},
  spec:{
    'install-root':root,entry:local,scope:'global','entry-points':[{id:'home','display-name':'Legal Matters',route:'/render?document=.%2Fcanvas%2Fhome.page.yaml',order:10}],
    launch:{enabled:true,'entry-point':'home',pinnable:true},permissions:['file.read','file.write','execution.run','execution.read'],scopes:['legal-matters.default'],
    dependencies:['canvas','nodejs','crm','project','timesheets','expenses','invoicing'].map(name=>({package:`verentis/${name}`,version:'latest'})),
    settings:[
      {key:'pilot-mode','display-name':'Pilot mode',type:'string',default:'disabled',description:'Only isolated-synthetic enables workflows. Real client mode is not supported.'},
      {key:'synthetic-workspace-id','display-name':'Isolated synthetic workspace UUID',type:'string',default:'',description:'Must equal the actual runtime workspace UUID. Do not set in a shared or client workspace.'},
    ],
    engine:'verentis/nodejs',scripts:['scripts/workflow'],'file-access':[...documentFileAccess(pages),...scriptConsent(script,access)],
    install:[
      ...[['canvas/*.form.yaml','canvas/','application/vnd.verentis.canvas.form+yaml'],['canvas/*.page.yaml','canvas/','application/vnd.verentis.canvas.page+yaml'],
        ['schemas/*.schema.json','schemas/','application/schema+json'],['templates/*.json','templates/','application/json']].map(([from,to,mime])=>({from,to:`${root}/${to}`,mime,mode:'managed'})),
      {from:'seed/matters',to:matters,mode:'seed',mime:folderMime},
      {from:'seed/register.json',to:register,mode:'seed',mime:'application/json'},
    ],
    creatables:[{id:'matter','display-name':'Synthetic legal matter',description:'Guarded intake in an isolated pilot workspace',icon:'lucide:briefcase-business',mime,
      parents:[folderMime],script:'./scripts/workflow',template:'./templates/matter.json'}],
    sandbox:{'allow-scripts':true,'allow-same-origin':true,'allow-forms':true,'allow-popups':false},
  },
  packaging:{publisher:'verentis',files:['canvas/**','schemas/**','templates/**','seed/**','scripts/**','README.md'],templates:['canvas/*.yaml'],variables:{'canvas-origin':local},encryption:'none'},
}
const overlay = entry => json({'api-version':'verentis.io/v1',kind:'Application',metadata:{id},spec:{entry},packaging:{variables:{'canvas-origin':entry}}})
await generate({root:new URL('../',import.meta.url), label:'Legal Matters', directories:['canvas','schemas','templates','seed'],
  outputs:{'legal-matters.app.yaml':json(manifest),'environments/feature.yaml':overlay('https://canvas.${param:apps-domain}'),
    'environments/production.yaml':overlay('https://canvas.apps.verentis.io'),'seed/matters':'','seed/register.json':json({version:1,batches:[]}),
    'schemas/matter.schema.json':json(schema),'templates/matter.json':json(template),
    ...Object.fromEntries(Object.entries(pages).map(([name,value])=>[`canvas/${name}`,json(value)])),
    'scripts/workflow/manifest.yaml':scriptManifest(script,access,'Isolated synthetic pilot only.'),
    'scripts/workflow/initial.mjs':`// Generated from the matter contracts.\nexport const initial = ${json(template)}export const editable = ${json(Object.fromEntries(
      ['team','links','charges','billingReviewer','title','parties','project','engagement','currency','rates','fixedFee','reviewBy','disposition','reviewReason'].map(k=>[k,schema.properties[k]])))}`,
    'scripts/workflow/ledger.mjs':await sharedSource('ledger.mjs'),
  },
})
