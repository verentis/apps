// Generates the Manufacturing Canvas documents: one bound form per record kind, the launch page, the BoM list
// and the manufacturing order list. Production rules (active BoMs, positive quantities, demand computation,
// stock-move emission, immutability once done) are enforced by the production script the forms run; the forms
// only lock what the script has confirmed or completed.
import { views } from './views.mjs'
import { listPages } from './lists.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, grid, heading, humanize,
  iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction, appOperationsSource, offers, withAppCall,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, inventory, mimeTypes, products, recordKinds, schemaId } from './contracts.mjs'
import { entities, postScriptPath } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['done'], warning: ['draft', 'confirmed', 'in-progress'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Manufacturing schemas and run the production script' }
const idle = 'form.saving || form.dirty'
// Orders stay editable while drafting; confirming computes the demand and locks the order.
const draft = "(!form.values.status || form.values.status === 'draft')"

// Canvas expressions only have floating point numbers, so quantities are summed as integer ten-thousandths
// (exact for every quantity a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000)`

const doneStock = "(data.stockmoves || []).filter(m => m.kind === 'file' && m.data && m.data.status === 'done')"
const onHand = product => `${doneStock}.reduce((s, m) => s + (m.data.product === ${product} ? (m.data.toWarehouse ? Number(m.data.quantity || 0) : 0) - (m.data.fromWarehouse ? Number(m.data.quantity || 0) : 0) : 0), 0)`
const productLabel = product => `((((data.products || []).find(p => p.path === ${product}) || {}).data || {}).name || ${product})`
const previewExpr = `((((data.boms || []).find(b => b.path === form.values.bom) || {}).data || {}).components || []).filter(c => !!c.product).map(c => ({ product: c.product, name: c.name || ${productLabel('c.product')}, needed: Number(c.quantity || 0) * Number(form.values.quantity || 0), onhand: ${onHand('c.product')} })).map(r => ({ product: r.product, name: r.name, needed: r.needed, onhand: r.onhand, short: r.needed - r.onhand }))`

const bomSources = {
  boms: folder(containers.boms.path, mimeTypes.bom),
  bomoptions: { kind: 'computed', expr: options('boms', "e.data.productName || ''") },
}
const productSources = {
  products: folder(products.path, products.mime),
  productoptions: { kind: 'computed', expr: options('products', "(e.data.name || '') + (e.data.sku ? ' (' + e.data.sku + ')' : '')") },
}

/** Kind-specific data, access, actions, header buttons and links of a record form. */
/** Inventory records a completed order's stock moves through its API; the order's code keys the call. */
const orderProduction = { app: 'inventory', operation: 'record-production', script: postScriptPath, recordOperation: 'record-moves',
  parameter: 'moves', field: 'productionRequest', returned: 'moves', key: "'production-' + form.values.code" }

function recordExtras(kind) {
  if (kind === 'bom') {
    return {
      locked: 'false',
      access: [{ path: products.path, reason: 'Offer the products to build (when Products is installed)' }, schemaAccess],
      data: productSources,
      notices: [
        stats([
          stat('Components', '{{ (form.values.components || []).length }}', 'list'),
          stat('Operations', '{{ (form.values.routing || []).length }}', 'route'),
          stat('Minutes per run', `{{ ${display(`(form.values.routing || []).reduce((s, r) => s + ${units('r.minutes')}, 0)`)} }}`, 'timer'),
        ], 3),
      ],
      buttons: [], links: [], panels: null, actions: {},
    }
  }
  const demandRows = `{{ (form.values.demand || []).map((d, i) => ({ product: d.product, name: d.name, quantity: d.quantity })) }}`
  const moveRows = `{{ (form.values.moves || []).map(m => ({ path: m.path, move: m.path.split('/').pop() })) }}`
  return {
    locked: `!${draft}`,
    access: [
      { path: containers.boms.path, reason: 'Choose the bill of materials to build' },
      { path: inventory.moves, reason: 'Show what is in stock for the components (when Inventory is installed)' },
      { path: products.path, reason: 'Name the components (when Products is installed)' },
      schemaAccess,
    ],
    data: {
      ...bomSources,
      ...appOperationsSource,
      stockmoves: folder(inventory.moves, inventory.moveMime),
      products: folder(products.path, products.mime),
      // Before confirming: each BoM component × the quantity to make, against done stock across warehouses.
      preview: { kind: 'computed', expr: previewExpr },
    },
    notices: [
      stats([
        stat('Produces', "{{ form.values.productName || '—' }}", 'package'),
        stat('Quantity', "{{ form.values.quantity || '0' }}", 'hash'),
        stat('Scheduled', "{{ form.values.scheduledDate || '—' }}", 'calendar'),
      ], 3),
    ],
    buttons: [
      button('Confirm', 'confirm', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      button('Start', 'start', { visible: "form.values.status === 'confirmed'", disabled: idle }, undefined, 'play'),
      button('Complete', 'complete', { visible: "form.values.status === 'in-progress'", disabled: idle }, undefined, 'check-check'),
      button('Cancel order', 'cancel', { visible: `(${draft} || form.values.status === 'confirmed') && !(${archived})`, disabled: idle }, 'ghost', 'x'),
      // Done but no stock moves yet (Inventory arrived later, or recording failed): ask Inventory again.
      button('Record stock moves', 'record-production', { visible: `form.values.status === 'done' && !(form.values.moves && form.values.moves.length) && ${offers('inventory', 'record-production')}`, disabled: idle }, 'outline', 'arrow-left-right'),
    ],
    links: [linkButton('Bill of materials', 'form.values.bom', 'list-tree')],
    panels: [
      { ...card('Will it build?', [
        text('The BoM components × the quantity to make, against what Inventory has on hand. Confirming computes the demand for real.', 'muted'),
        table("{{ (data.preview || []).map(r => ({ path: r.product, product: r.name, needed: r.needed.toFixed(2), onhand: r.onhand.toFixed(2), short: r.short > 0 ? r.short.toFixed(2) : '' })) }}",
          [['product', 'Component'], ['needed', 'Needed', 'end'], ['onhand', 'On hand', 'end'], ['short', 'Short', 'end']], 'Choose a bill of materials and a quantity'),
        { type: 'canvas.alert', props: { tone: 'warning', title: 'Not enough stock', text: "{{ (data.preview || []).filter(r => r.short > 0).length + ' component(s) short. The order can still be confirmed; production waits for stock.' }}" },
          rules: { visible: '(data.preview || []).some(r => r.short > 0)' } },
      ]), rules: { visible: draft } },
      card('Component demand', [
        text('Computed from the BoM components × the quantity to produce when the order is confirmed.', 'muted'),
        table(demandRows, [['product', 'Product'], ['name', 'Name'], ['quantity', 'Quantity', 'end']], 'Not confirmed yet'),
      ]),
      card('Stock moves', [
        text('Inventory records the consumption and production moves when the order completes, when Inventory is installed.', 'muted'),
        table(moveRows, [['move', 'Move'], ['path', 'Path']], 'No stock moves emitted', true),
      ]),
    ],
    actions: {
      confirm: scriptAction(postScriptPath, 'confirm-mo', {
        confirm: { title: 'Confirm order', message: 'Confirm this manufacturing order? Its component demand is computed from the bill of materials and the order is locked.' },
      }),
      start: scriptAction(postScriptPath, 'start-mo', {
        confirm: { title: 'Start production', message: 'Start production of this manufacturing order?' },
      }),
      complete: withAppCall(scriptAction(postScriptPath, 'complete-mo', {
        confirm: { title: 'Complete order', message: 'Complete this manufacturing order? When Inventory is installed, it records the consumption and production stock moves. Done orders cannot be edited.' },
      }), orderProduction),
      'record-production': withAppCall(scriptAction(postScriptPath, 'complete-mo', {}), orderProduction),
      cancel: { steps: [
        { confirm: { title: 'Cancel order', message: 'Cancel this manufacturing order? Cancelled orders cannot be confirmed or completed.' } },
        { 'patch-form': { values: { status: 'cancelled', cancelledAt: '{{ Date() }}', updatedAt: '{{ Date() }}' } } },
        { save: {} },
        { toast: { message: 'Cancelled', variant: 'success' } },
      ] },
    },
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = extras.locked
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
    ...(extras.panels ? [grid(extras.panels)] : []),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `manufacturing-${kind}`, displayName: `Manufacturing ${entity.singular.toLowerCase()}`,
      description: `View and edit a Manufacturing ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access,
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

const orderRows = `(data.orders || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, productName: e.data.productName || '', quantity: e.data.quantity || '', scheduledDate: e.data.scheduledDate || '', status: e.data.status || 'draft', components: (e.data.demand || []).length, units: ${units('e.data.quantity')} }))`
const orderSources = {
  orders: folder(containers.orders.path, mimeTypes.order),
  orderrows: { kind: 'computed', expr: orderRows },
}
const inProduction = `{{ ${display(`(data.orderrows || []).filter(r => r.status === 'confirmed' || r.status === 'in-progress').reduce((s, r) => s + r.units, 0)`)} }}`

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Code' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'manufacturing-home', name: 'Manufacturing', description: 'Production summary.', icon: 'factory' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          { path: containers.boms.path, reason: 'List bills of materials' },
          { path: containers.orders.path, reason: 'List manufacturing orders' },
        ],
        data: { ...bomSources, ...orderSources },
        tree: page([
          pageHeader(
            [heading('Manufacturing'), text('Bills of materials and manufacturing orders are files in your workspace. Draft an order in its folder, then confirm, start and complete it from its form.', 'muted')], [
            row([
              button('Manufacturing orders', [openFile(`${installRoot}/canvas/orders.page.yaml`)], undefined, 'outline', 'factory'),
              button('Bills of materials', [openFile(`${installRoot}/canvas/boms.page.yaml`)], undefined, 'outline', 'list-tree'),
            ]),
          ]),
          stats([
            stat('Bills of materials', count('boms'), 'list-tree', loading('boms')),
            stat('Draft orders', count('orders', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('orders')),
            stat('In production', count('orders', "e.data.status === 'confirmed' || e.data.status === 'in-progress'"), 'factory', loading('orders')),
            stat('Units in production', inProduction, 'package', loading('orders')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Manufacturing to recreate it.`)[0]),
          tabs([
            { value: 'orders', label: 'Manufacturing orders', icon: 'factory' },
            { value: 'boms', label: 'Bills of materials', icon: 'list-tree' },
          ], [
            panel('orders', [row([button('Open /manufacturing-orders', [openFile(containers.orders.path)], undefined, 'outline', 'folder-open')]),
              browse('orders', 'order', [{ key: 'data.productName', label: 'Product' }, { key: 'data.quantity', label: 'Quantity', align: 'end' }, { key: 'data.scheduledDate', label: 'Scheduled' }, { key: 'data.status', label: 'Status' }])]),
            panel('boms', [row([button('Open /bills-of-materials', [openFile(containers.boms.path)], undefined, 'outline', 'folder-open')]),
              browse('boms', 'bom', [{ key: 'data.productName', label: 'Product' }, { key: 'data.outputQty', label: 'Output', align: 'end' }])]),
          ]),
        ]),
      },
    },
  }
}

function bomsPage() {
  const rows = `{{ (data.boms || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, productName: e.data.productName || '', outputQty: e.data.outputQty || '', components: (e.data.components || []).length, operations: (e.data.routing || []).length })) }}`
  return {
    file: 'boms.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'manufacturing-boms', name: 'Bills of materials', description: 'The bills of materials production builds from.', icon: 'list-tree' },
      spec: {
        access: [{ path: containers.boms.path, reason: 'List bills of materials' }],
        data: bomSources,
        tree: page([
          pageHeader(
            [heading('Bills of materials'), text('What each product is built from. Archived BoMs cannot be confirmed against.', 'muted')], [
            row([
              button('Open /bills-of-materials', [openFile(containers.boms.path)], undefined, 'outline', 'folder-open'),
              button('Manufacturing', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'factory'),
            ]),
          ]),
          ...status('boms'),
          table(rows, [['code', 'BoM'], ['productName', 'Product'], ['outputQty', 'Output', 'end'], ['components', 'Components', 'end'], ['operations', 'Operations', 'end']],
            'No bills of materials yet. Use New in /bills-of-materials.', true),
        ]),
      },
    },
  }
}

function ordersPage() {
  const rows = `{{ (data.orderrows || []).filter(r => state.showclosed || (r.status !== 'done' && r.status !== 'cancelled')) }}`
  return {
    file: 'orders.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'manufacturing-orders', name: 'Manufacturing orders', description: 'Manufacturing orders by status.', icon: 'factory' },
      spec: {
        access: [{ path: containers.orders.path, reason: 'List manufacturing orders' }],
        data: orderSources,
        state: { showclosed: false },
        tree: page([
          pageHeader(
            [heading('Manufacturing orders'), text('Orders move draft → confirmed → in progress → done. Confirmed orders are locked; done orders emitted their stock moves.', 'muted')], [
            row([
              button('Open /manufacturing-orders', [openFile(containers.orders.path)], undefined, 'outline', 'folder-open'),
              button('Manufacturing', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'factory'),
            ]),
          ]),
          ...status('orders'),
          stats([
            stat('Draft', count('orders', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('orders')),
            stat('Confirmed', count('orders', "e.data.status === 'confirmed'"), 'check', loading('orders')),
            stat('In progress', count('orders', "e.data.status === 'in-progress'"), 'play', loading('orders')),
            stat('Done', count('orders', "e.data.status === 'done'"), 'check-check', loading('orders')),
          ]),
          { type: 'canvas.form.switch', props: { label: 'Show done and cancelled orders', value: '{{ state.showclosed }}' } },
          table(rows, [['code', 'Order'], ['productName', 'Product'], ['quantity', 'Quantity', 'end'],
            ['scheduledDate', 'Scheduled'], ['components', 'Demand lines', 'end'], ['status', 'Status']], 'No open manufacturing orders', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), bomsPage(), ordersPage(), ...recordKinds.map(recordForm), ...listPages()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
