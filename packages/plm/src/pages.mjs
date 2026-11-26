// Generates the PLM Canvas documents: the engineering change order form and the launch page listing ECOs by
// stage. Review rules (submit, approve with an approver, reject with a reason, apply with an effective date)
// are enforced by the review script the form runs; the form only locks what the script has decided.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, grid, heading, humanize,
  iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, text, toneExpression, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, manufacturing, mimeTypes, recordKinds, schemaId, stages } from './contracts.mjs'
import { entities, postScriptPath } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['approved', 'applied'], warning: ['draft', 'in-review'], danger: ['rejected'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the PLM schemas and run the review script' }
const idle = 'form.saving || form.dirty'
// ECOs are edited while drafting and during review (the approver and a rejection reason are typed then);
// approving, applying or rejecting locks the record.
const open = "(!form.values.stage || form.values.stage === 'draft' || form.values.stage === 'in-review')"

const bomSources = {
  boms: folder(manufacturing.boms, manufacturing.bomMime),
  bomoptions: { kind: 'computed', expr: options('boms', "(e.data.productName || '') + (e.data.code ? ' (' + e.data.code + ')' : '')") },
}

function recordForm(kind) {
  const entity = entities[kind]
  const locked = `!${open}`
  const readOnly = `${archived} || (${locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }}`, 'muted'),
    ]),
    row([
      button('Submit for review', 'submit', { visible: `(!form.values.stage || form.values.stage === 'draft') && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'send'),
      button('Approve', 'approve', { visible: "form.values.stage === 'in-review'", disabled: idle }, undefined, 'check'),
      button('Reject', 'reject', { visible: "form.values.stage === 'in-review'", disabled: idle }, 'ghost', 'x'),
      button('Apply', 'apply', { visible: "form.values.stage === 'approved'", disabled: idle }, undefined, 'check-check'),
      button('Reopen', 'reopen', { visible: `form.values.stage === 'rejected' && !(${archived})`, disabled: idle }, 'ghost', 'rotate-ccw'),
      recordButtons(locked),
    ]),
  ], 'between')
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    archivedAlert(entity.singular),
    row([linkButton('Product / BoM', 'form.values.product', 'list-tree')]),
    stats([
      stat('Stage', `{{ form.values.stage || 'draft' }}`, 'milestone'),
      stat('Priority', `{{ form.values.priority || 'normal' }}`, 'flag'),
      stat('Effective', "{{ form.values.effectiveDate || '—' }}", 'calendar'),
    ], 3),
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `plm-${kind}`, displayName: `PLM ${entity.singular.toLowerCase()}`,
      description: `View and review a PLM ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [
        { path: manufacturing.boms, reason: 'Offer Manufacturing bills of materials to reference (when Manufacturing is installed)' },
        schemaAccess,
      ],
      data: bomSources, tree,
      actions: {
        ...baseActions,
        submit: scriptAction(postScriptPath, 'submit-review', {
          confirm: { title: 'Submit for review', message: 'Submit this engineering change order for review?' },
        }),
        approve: scriptAction(postScriptPath, 'approve', {
          confirm: { title: 'Approve change', message: 'Approve this engineering change order? Fill in the approver first; approved ECOs can only be applied.' },
        }),
        reject: scriptAction(postScriptPath, 'reject', {
          confirm: { title: 'Reject change', message: 'Reject this engineering change order? Fill in the rejection reason first. Rejected ECOs are locked until reopened.' },
        }),
        apply: scriptAction(postScriptPath, 'apply', {
          confirm: { title: 'Apply change', message: 'Apply this engineering change order? The effective date is stamped and the ECO is locked.' },
        }),
        reopen: { steps: [
          { confirm: { title: 'Reopen change', message: 'Reopen this rejected engineering change order as a draft?' } },
          { 'patch-form': { values: { stage: 'draft', rejectionReason: '', updatedAt: '{{ Date() }}' } } },
          { save: {} },
          { toast: { message: 'Reopened as draft', variant: 'success' } },
        ] },
      },
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

const ecoRows = `(data.ecos || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', type: e.data.type || '', priority: e.data.priority || '', effectiveDate: e.data.effectiveDate || '', stage: e.data.stage || 'draft' }))`
const ecoSources = {
  ecos: folder(containers.ecos.path, mimeTypes.eco),
  ecorows: { kind: 'computed', expr: ecoRows },
}

function homePage() {
  const rows = `{{ (data.ecorows || []).filter(r => state.showclosed || (r.stage !== 'applied' && r.stage !== 'rejected')) }}`
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'plm-home', name: 'PLM', description: 'Engineering change orders by stage.', icon: 'file-cog' },
      spec: {
        access: [{ path: containers.ecos.path, reason: 'List engineering change orders' }],
        data: ecoSources,
        state: { showclosed: false },
        tree: page([
          pageHeader(
            [heading('PLM'), text('Engineering change orders are files in your workspace. Draft one in its folder, submit it for review, then approve and apply it (or reject it with a reason) from its form.', 'muted')], [
            row([button('Open /engineering-change-orders', [openFile(containers.ecos.path)], undefined, 'outline', 'folder-open')]),
          ]),
          stats(stages.map(stage => stat(stage.split('-').join(' ').replace(/^./, first => first.toUpperCase()),
            count('ecos', `(e.data.stage || 'draft') === '${stage}'`),
            { draft: 'file-pen', 'in-review': 'eye', approved: 'check', applied: 'check-check', rejected: 'x' }[stage], loading('ecos')))),
          ...status('ecos', `The ${containers.ecos.path} folder could not be read. Reinstall PLM to recreate it.`),
          { type: 'canvas.form.switch', props: { label: 'Show applied and rejected changes', value: '{{ state.showclosed }}' } },
          table(rows, [['code', 'ECO'], ['title', 'Title'], ['type', 'Type'], ['priority', 'Priority'],
            ['effectiveDate', 'Effective'], ['stage', 'Stage']], 'No open engineering change orders. Use New in /engineering-change-orders.', true),
          card('Browse', [
            browser(containers.ecos.path, mimeTypes.eco, [
              { key: 'name', label: 'Code' }, { key: 'data.title', label: 'Title' }, { key: 'data.stage', label: 'Stage' },
            ], 'No engineering change orders yet. Use New in /engineering-change-orders.'),
          ]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), ...recordKinds.map(recordForm), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
