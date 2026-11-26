import { views } from './views.mjs'
import {
  apiVersion, boundForm, button, card, folder, grid, heading, openFile, page,
  projectRegistration, row, scriptPermissions, status, table, text, appNavigation, listPage,
} from '../../../tools/file-apps/canvas.mjs'
import { catalog, contracts, mime, packs, precedents, root, schemaId } from '../scripts/draft/model.mjs'

const expr = value => `{{ ${value} }}`
const state = key => expr(`state.${key}`)
const control = (key, label, type = 'input', extra = {}) => ({
  type: `canvas.form.${type}`, props: { label, value: state(key), ...extra },
})
const set = (key, value) => ({ 'set-state': { key, value } })
const refresh = source => ({ 'refresh-source': { source } })
const params = (...names) => Object.fromEntries(names.map(k => [k, state(k)]))
const action = (script, parameters, tail = [], confirm) => ({
  permissions: scriptPermissions,
  steps: [
    ...(confirm ? [{ confirm: { title: 'Confirm', message: confirm } }] : []),
    { 'run-script': { file: `${root}/scripts/${script}`, parameters, timeout: 120, assign: 'result' } },
    ...tail, { toast: { message: expr("state.result.message || 'Saved'"), variant: 'success' } },
  ],
})
const access = (path, reason) => ({ path, reason })
const scriptAccess = name => access(`${root}/scripts/${name}`, `Run the ${name} operation`)
const initial = (...keys) => Object.fromEntries(keys.map(k => [k, '']))
const display = (node, visible) => ({ ...node, rules: { visible } })
const choose = (key, label, options) => control(key, label, 'select', { options })

function home() {
  return {
    'api-version': apiVersion, kind: 'Page',
    metadata: { id: 'contract-studio-home', name: 'Contract Studio', icon: 'file-pen-line' },
    spec: {
      access: [access(contracts, 'List workspace agreements'), scriptAccess('draft'), scriptAccess('library')],
      data: { agreements: folder(contracts, mime('contract')) },
      state: { ...initial('code','title','matter','clauseCode','clauseTitle','wording','jurisdiction','intendedUse','approvedBy'),
        revision: 1, confirmed: false, result: {} },
      actions: {
        create: action('draft', { operation: 'create', ...params('code','title','matter') }, [refresh('agreements'), openFile(state('result.path'), 'edit')]),
        publish: action('library', { code: state('clauseCode'), title: state('clauseTitle'),
          ...params('revision','wording','jurisdiction','intendedUse','approvedBy','confirmed') }, [set('confirmed', false)],
        'Publish this firm-approved revision? Revisions cannot be edited here.'),
      },
      tree: page([
        heading('Contract Studio'), text('Draft ordered points, review their sources, then issue a clean agreement.', 'muted'),
        card('Start an agreement', [grid([control('code','Unique agreement code'), control('title','Client-facing title'),
          control('matter','Optional matter path', 'input', { placeholder: '/legal-matters/MAT-0001 (not opened or verified)' })]),
        button('Create and open draft','create')]),
        card('Agreements', [...status('agreements'), table(expr("(data.agreements || []).filter(e => e.data).map(e => ({path:e.path, code:e.data.code, title:e.data.title, stage:e.data.stage}))"),
          [['code','Code'],['title','Title'],['stage','Stage']], 'No agreements yet.', true)]),
        card('Publish a firm precedent revision', [text('For authorised library editors. Publish original firm wording only. Use double braces around a variable name, for example two opening braces, client, and two closing braces.'),
          grid([control('clauseCode','Stable clause code'), control('revision','Revision number','number',{ min: 1, step: 1 }),
            control('clauseTitle','Clause title'), control('jurisdiction','Jurisdiction'), control('intendedUse','Intended use'),
            control('approvedBy','Approved by')]), control('wording','Approved template','textarea'),
          control('confirmed','I confirm clearance for reuse and removal of all client details','switch'), button('Publish immutable revision','publish')]),
      ]),
    },
  }
}

function contract() {
  const ctx = { path: expr('ctx.file.path'), version: expr('form.values.version') }
  const draft = "form.values.stage === 'draft'"
  const reviewing = "form.values.stage === 'in-review'"
  const approved = "form.values.stage === 'approved' || form.values.stage === 'issued'"
  const edit = (operation, fields = {}, confirm) => action('draft', { operation, ...ctx, ...fields }, [refresh('record')], confirm)
  const target = params('pointId')
  const withText = params('pointId','wording','bindings','note')
  const compare = params('pointId','sourceKind','precedentPath')
  const firmUpdate = "p.precedent && (data.library || []).some(e => e.data && e.data.code === p.precedent.code && e.data.revision > p.precedent.revision)"
  const authorityUpdate = `p.authority && (p.authority.catalog === state.catalog || (p.authority.catalog === '${catalog}' && state.catalog === '${packs}/ZA')) && ((data.authorities && data.authorities.authorities) || []).some(a => a.id === p.authority.id && a.revision !== p.authority.revision)`
  const pointRows = `(form.values.points || []).map((p, i) => ({ id:p.id, number:i+1, origin:p.origin, template:p.precedent ? p.precedent.wording : '', revision:p.precedent ? p.precedent.code+' v'+p.precedent.revision : '', wording:p.origin === 'firm' ? (p.variation || p.precedent.wording) : p.wording, edit:p.origin === 'firm' ? (p.variation || '') : p.wording, bindings:p.bindings, note:p.note, citation:p.authority ? p.authority.citation+' · '+p.authority.pinpoint+' · '+p.authority.coverage+' · '+p.authority.revision+' · '+p.authority.sourceUrl : '', update: (${firmUpdate}) || (${authorityUpdate}) ? 'Revision available for review' : '', decision:p.sourceDecision ? p.sourceDecision.decision : '' }))`
  const listing = table(expr(pointRows), [['number','#'],['id','Point ID'],['origin','Origin'],['revision','Firm revision'],['template','Approved base'],
    ['wording','Current template'],['bindings','Confirmed values'],['note','Internal note'],['citation','Authority (link only)'],['update','Source check'],['decision','Source decision']], 'No points yet.')
  listing.props.clickable = true
  listing.on = { 'row-click': [set('pointId', expr('event.id')), set('wording', expr('event.edit')), set('bindings', expr('event.bindings')),
    set('note', expr('event.note')), set('position', expr('event.number')), set('result', {})] }
  return boundForm({
    name: 'contract-studio-contract', displayName: 'Contract Studio agreement', description: 'Edit points and review pinned sources.', icon: 'file-pen-line',
    mime: mime('contract'), schemaId, schemaSource: `${root}/schemas/contract.schema.json`,
    access: [scriptAccess('draft'), scriptAccess('issue'), access(`${root}/schemas/contract.schema.json`, 'Identify the agreement schema'),
      access(precedents, 'Choose approved firm revisions'),
      access(packs, 'Choose bibliographic references in optional installed jurisdiction packs')],
    data: { library: folder(precedents, mime('precedent')), packs: folder(packs, 'application/vnd.verentis.legal-research.pack+json'),
      authorities: { kind: 'computed', expr: '((data.packs || []).find(e => e.path === state.catalog) || {}).data' } },
    state: { ...initial('title','matter','pointId','wording','bindings','note','precedentPath','authorityId','pinpoint','reviewer'),
      position: 1, catalog: '', sourceKind: 'firm', decision: 'defer', result: {} },
    actions: {
      metadata: edit('metadata', params('title','matter')),
      inline: edit('add-inline', withText), firm: edit('add-firm', { ...withText, ...params('precedentPath') }),
      update: edit('edit-point', withText), move: edit('move', params('pointId','position')),
      remove: edit('remove', target, 'Remove this point? Review will reject references to the removed ID.'),
      attach: edit('attach', params('pointId','catalog','authorityId','pinpoint')), detach: edit('detach',target),
      compare: action('draft',{ operation:'compare', ...ctx, ...compare }),
      decide: edit('decide', { ...compare, ...params('decision'), token: state('result.token') }),
      submit: edit('submit'), return: edit('return'), approve: edit('approve', params('reviewer'), 'Freeze the reviewed client text, source schedule and digests?'),
      issue: action('issue', ctx, [refresh('record')], 'Materialise the approved snapshot into separate client and internal files?'),
    },
    tree: [
      heading(expr("form.values.title || 'Agreement'")), text('Agreement {{ form.values.code }} · {{ form.values.stage }} · revision {{ form.values.version }} · {{ form.values.matter }}'),
      ...status('record'),
      display(card('Agreement details', [button('Load current details', [set('title',expr('form.values.title')),set('matter',expr('form.values.matter'))],undefined,'ghost'),
        grid([control('title','Client-facing title'),control('matter','Optional matter path')]),button('Update agreement details','metadata')]), draft),
      card('Agreement', [text('The points as the client will read them, numbered as they stand. Click a point to load it into the editor below.', 'muted'), {
        type: 'canvas.outline',
        props: {
          readOnly: true, selectable: true, selected: '{{ state.pointId }}',
          value: expr("(form.values.points || []).map(p => ({ id: p.id, level: 0, text: p.origin === 'firm' ? (p.variation || (p.precedent && p.precedent.wording) || '') : (p.wording || '') }))"),
          // Confirmed values (one name=value per line on each point) fill the {{ name }} chips.
          variables: expr("(form.values.points || []).map(p => String(p.bindings || '')).join('\\n').split('\\n').filter(line => line.indexOf('=') > 0).reduce((all, line) => withPath(all, line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()), {})"),
        },
        on: { select: [set('pointId', expr('event.id')), set('wording', expr("((form.values.points || []).find(p => p.id === event.id) || {}).origin === 'firm' ? (((form.values.points || []).find(p => p.id === event.id) || {}).variation || '') : (((form.values.points || []).find(p => p.id === event.id) || {}).wording || '')")),
          set('bindings', expr("((form.values.points || []).find(p => p.id === event.id) || {}).bindings || ''")), set('note', expr("((form.values.points || []).find(p => p.id === event.id) || {}).note || ''")), set('position', expr('event.index + 1')), set('result', {})] },
      }]),
      card('Points and sources', [text('Select a row to load it into the editor. Point IDs stay fixed when numbering changes. No citation or internal note is copied into the client document.'), listing]),
      display(card('Point editor', [grid([control('pointId','Stable point ID'),control('position','Move to position','number',{ min:1, step:1 })]),
        control('wording','Inline wording / local variation','textarea',{ description:'Leave blank on a firm point to retain the approved template. To refer to another point, put point:ID inside double braces.' }),
        control('bindings','Confirmed variables, one name=value per line','textarea'),control('note','Internal note (never exported to client)','textarea'),
        choose('precedentPath','Firm revision', expr("(data.library || []).filter(e => e.data).map(e => ({label:e.data.title+' · '+e.data.code+' v'+e.data.revision+' · '+e.data.jurisdiction, value:e.path}))")),
        text(expr("(data.library || []).filter(e => e.path === state.precedentPath && e.data).map(e => e.data.intendedUse+' — '+e.data.wording).join('')")),
        row([button('Add inline point','inline'),button('Insert firm revision','firm'),button('Save selected point','update'),button('Move','move'),button('Remove','remove',undefined,'ghost')])]), draft),
      display(card('Statutory support · link only', [
        text('Use your own wording. A citation does not establish applicability, commencement or compliance. Research is optional for drafting.'),
        choose('catalog','Installed catalogue',expr("[{label:'Choose a country pack',value:''}].concat((data.packs || []).filter(e => e.kind === 'file').map(e => ({label:e.name,value:e.path})))")),
        ...status('packs','Install a country pack to attach citations; authoring remains available.'),
        choose('authorityId','Authority',expr("((data.authorities && data.authorities.authorities) || []).filter(a => a.rights === 'link-only').map(a => ({label:a.jurisdiction+' · '+a.citation+' · '+a.coverage+' · '+a.revision,value:a.id}))")),
        control('pinpoint','Pinpoint in the cited provision'),row([button('Attach citation to point','attach'),button('Remove citation','detach',undefined,'ghost')])]),draft),
      display(card('Review a dependency update', [
        text('Select a point. For a firm clause, choose a newer revision of that same clause above. For an authority, compare against its installed catalogue. No change is applied automatically.'),
        choose('sourceKind','Source',[{label:'Firm revision',value:'firm'},{label:'Statutory authority',value:'authority'}]),
        button('Compare pinned and available sources','compare'),
        text('Pinned: {{ state.result.before }}'),text('Available: {{ state.result.after }}'),
        choose('decision','Decision',['accept','reject','defer'].map(value => ({label:value,value}))),button('Record decision','decide',{disabled:'!state.result.token'})]),draft),
      display(card('Review', [text('Review validates all variables and point references and renders exactly what the client will receive.'),button('Submit for review','submit')]),draft),
      display(card('Client text for review', [text(expr('form.values.review && form.values.review.client')),control('reviewer','Approving reviewer'),
        row([button('Return to draft','return'),button('Approve and freeze','approve')])]),reviewing),
      display(card('Approved snapshot', [text(expr('form.values.snapshot && form.values.snapshot.client')),text('Client SHA-256: {{ form.values.snapshot && form.values.snapshot.clientSha256 }}'),
        button('Issue or verify all files','issue'),text('Client text: {{ form.values.clientPath }}'),text('Office-editable copy: {{ form.values.officePath }}'),text('Internal schedule: {{ form.values.schedulePath }}'),
        text('Copy the issued .fodt to a negotiation file before editing it in Office. Keep the original unchanged.'),
        row([button('Open client text',[openFile(expr('form.values.clientPath'),'view')],{visible:"form.values.stage === 'issued'"}),
          button('Open internal schedule',[openFile(expr('form.values.schedulePath'),'view')],{visible:"form.values.stage === 'issued'"})])]),approved),
    ],
  })
}

// The design's Clause library and Issued lists.
const library = listPage({ file: 'library.page.yaml', id: 'contract-studio-library', name: 'Clause library', description: 'Published firm precedent revisions: jurisdiction, intended use and approver.', icon: 'library',
  container: precedents, mime: mime('precedent'),
  rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', revision: e.data.revision, jurisdiction: e.data.jurisdiction || '', use: e.data.intendedUse || '', approver: e.data.approvedBy || '', approved: e.data.approvedAt || '' })).sort((a, b) => (a.code + String(b.revision).padStart(6, '0')) < (b.code + String(a.revision).padStart(6, '0')) ? -1 : 1)",
  columns: [['code', 'Clause'], ['title', 'Title'], ['revision', 'Revision', 'end'], ['jurisdiction', 'Jurisdiction'], ['use', 'Intended use'], ['approver', 'Approved by'], ['approved', 'Approved', undefined, 'date']],
  empty: 'No precedent has been published yet. Publish one from the home page.' })
const issued = listPage({ file: 'issued.page.yaml', id: 'contract-studio-issued', name: 'Issued', description: 'Issued agreements and their client and internal files.', icon: 'file-check-2',
  container: contracts, mime: mime('contract'),
  rows: "RECORDS.filter(e => e.data.stage === 'issued').map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', version: e.data.version, client: e.data.clientPath || '', schedule: e.data.schedulePath || '' }))",
  columns: [['code', 'Agreement'], ['title', 'Title'], ['version', 'Version', 'end'], ['client', 'Client file'], ['schedule', 'Internal schedule']],
  empty: 'No agreement has been issued yet.' })

export const pages = appNavigation(Object.fromEntries([['home.page.yaml',home()],['contract.form.yaml',contract()],['library.page.yaml',library.document],['issued.page.yaml',issued.document]].map(([name,doc]) => [name,projectRegistration(doc,`${root}/canvas/${name}`)])), root, views)
