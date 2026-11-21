// Generates the Inventory Canvas documents: one bound form per record kind, the settings form, the launch page,
// the stock-level report and the low-stock widget. Stock rules (existing products and warehouses, positive
// quantities, immutability once done) are enforced by the posting script the forms run; the forms only lock what
// the script has done or applied.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading, iconName,
  linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction, sectionCards,
  stat, stats, status, table, tabs, text, toneExpression, humanize,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, lowStockWidgetFile, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = {
  success: ['done', 'applied'],
  warning: ['draft'],
}
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Inventory schemas and run the posting script' }
const productsAccess = reason => ({ path: containers.products.path, reason })
const warehousesAccess = reason => ({ path: containers.warehouses.path, reason })
const movesAccess = reason => ({ path: containers.moves.path, reason })
const productLabel = "(e.data.name || '') + (e.data.sku ? ' (' + e.data.sku + ')' : '')"
const warehouseLabel = "(e.data.name || '')"
const pickSources = {
  products: folder(containers.products.path, mimeTypes.product),
  warehouses: folder(containers.warehouses.path, mimeTypes.warehouse),
  productoptions: { kind: 'computed', expr: options('products', productLabel) },
  warehouseoptions: { kind: 'computed', expr: options('warehouses', warehouseLabel) },
}

// Report arithmetic runs in the Canvas expression language, which has only floating point numbers, so quantities
// are summed as integer ten-thousandths (exact for every quantity a file can hold) and only divided for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000)`
const doneMoves = `(data.moves || []).filter(m => m.kind === 'file' && m.data && m.data.kind === 'move' && m.data.status === 'done')`
/** Net done quantity of one product: into minus out of the given warehouse term (a JS expression over `m`). */
const netUnits = (product, into, outOf) =>
  `${doneMoves}.reduce((s, m) => s + (m.data.product === ${product} ? ((${into} ? ${units('m.data.quantity')} : 0) - (${outOf} ? ${units('m.data.quantity')} : 0)) : 0), 0)`
/** On-hand totals per product across all warehouses, with the reorder point in the same integer units. */
const totalsExpr = `(data.products || []).filter(e => e.kind === 'file' && e.data && e.data.kind === 'product').map(e => ({ path: e.path, code: e.data.code || e.name, product: e.data.name || '', sku: e.data.sku || '', unit: e.data.unit || '', reorderPoint: e.data.reorderPoint || '', hasReorder: !!e.data.reorderPoint, reorder: ${units('e.data.reorderPoint')}, units: ${netUnits('e.path', 'm.data.toWarehouse', 'm.data.fromWarehouse')} })).sort((a, b) => (a.code < b.code ? -1 : 1))`
const lowExpr = source => `(${source}).filter(t => t.hasReorder && t.units <= t.reorder)`

const idle = 'form.saving || form.dirty'

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
function recordExtras(kind) {
  if (kind === 'product') {
    const history = `(data.moves || []).filter(m => m.kind === 'file' && m.data && m.data.kind === 'move' && m.data.product === ctx.file.path).map(m => ({ path: m.path, date: m.data.date, move: m.data.code || m.name, reference: m.data.reference || '', from: (m.data.fromWarehouse || '').split('/').pop() + (m.data.fromLocation ? ' · ' + m.data.fromLocation : ''), to: (m.data.toWarehouse || '').split('/').pop() + (m.data.toLocation ? ' · ' + m.data.toLocation : ''), quantity: m.data.quantity, status: m.data.status })).sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))`
    return {
      access: [movesAccess('Show the stock moves of this product')],
      data: { moves: folder(containers.moves.path, mimeTypes.move) },
      tabs: [{ value: 'moves', label: 'Moves', icon: 'arrow-left-right' }],
      panels: [panel('moves', [
        ...status('moves'),
        stats([stat('On hand (done moves)', `{{ ${display(netUnits('ctx.file.path', 'm.data.toWarehouse', 'm.data.fromWarehouse'))} }}`, 'package', "{{ data.$moves.status === 'loading' }}")], 3),
        table(`{{ ${history} }}`, [['date', 'Date'], ['move', 'Move'], ['reference', 'Reference'], ['from', 'From'], ['to', 'To'], ['quantity', 'Quantity', 'end'], ['status', 'Status']],
          'No stock moves use this product yet', true),
      ])],
    }
  }
  if (kind === 'warehouse') return {}
  if (kind === 'move') {
    const draft = "(!form.values.status || form.values.status === 'draft')"
    return {
      locked: `!${draft}`,
      access: [productsAccess('Choose the product being moved'), warehousesAccess('Choose the from and to warehouses')],
      data: pickSources,
      buttons: [
        button('Post', 'post', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      ],
      links: [linkButton('Source', 'form.values.source && form.values.source.path', 'corner-left-up')],
      actions: {
        post: scriptAction(postScriptPath, 'post-move', { confirm: { title: 'Post stock move', message: 'Mark this move done? Done moves count towards stock on hand and cannot be edited.' } }),
      },
    }
  }
  const draft = "(!form.values.status || form.values.status === 'draft')"
  return {
    locked: `!${draft}`,
    access: [productsAccess('Choose the product being counted'), warehousesAccess('Choose the warehouse being counted')],
    data: pickSources,
    buttons: [
      button('Apply', 'apply', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
    ],
    links: [linkButton('Corrective move', 'form.values.move && form.values.move.path', 'arrow-left-right')],
    actions: {
      apply: scriptAction(postScriptPath, 'apply-adjustment', { confirm: { title: 'Apply adjustment', message: 'Apply this count? A corrective stock move brings the stock on hand to the counted quantity, and applied adjustments cannot be edited.' } }),
    },
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = extras.locked ?? 'false'
  const readOnly = `${archived} || (${locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...(extras.buttons ?? []), recordButtons(locked)]),
  ], 'between')
  const overview = [
    ...(extras.links?.length ? [row(extras.links)] : []),
    grid(sectionCards(entity.sections, readOnly)),
  ]
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...(extras.tabs
      ? [tabs([{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...extras.tabs], [panel('overview', overview), ...extras.panels])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `inventory-${kind}`, displayName: `Inventory ${entity.singular.toLowerCase()}`,
      description: `View and edit an Inventory ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...(extras.access ?? []), schemaAccess],
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'inventory-settings', displayName: 'Inventory settings', description: 'Edit the Inventory settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [warehousesAccess('Choose the default warehouse'), schemaAccess],
      data: {
        warehouses: folder(containers.warehouses.path, mimeTypes.warehouse),
        warehouseoptions: { kind: 'computed', expr: options('warehouses', warehouseLabel) },
      },
      tree: [
        row([
          column([heading('Inventory settings'), text('The warehouse new adjustments count by default. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        card('Settings', [grid(settingsFields.map(field => formControl(field, null)))]),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`
const code = { key: 'name', label: 'Code' }

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [code, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'inventory-home', name: 'Inventory', description: 'Inventory overview.', icon: 'package' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          productsAccess('List the products'),
          warehousesAccess('List the warehouses'),
          movesAccess('List stock moves'),
          { path: containers.adjustments.path, reason: 'List inventory adjustments' },
        ],
        data: {
          products: folder(containers.products.path, mimeTypes.product),
          warehouses: folder(containers.warehouses.path, mimeTypes.warehouse),
          moves: folder(containers.moves.path, mimeTypes.move),
          adjustments: folder(containers.adjustments.path, mimeTypes.adjustment),
        },
        tree: page([
          row([
            column([heading('Inventory'), text('Products, warehouses, stock moves and inventory adjustments as files in your workspace. Draft moves and counts in their folders, then post or apply them from their forms.', 'muted')]),
            row([
              button('Stock levels', [openFile(`${installRoot}/canvas/stock.page.yaml`)], undefined, 'outline', 'chart-column'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Products', count('products'), 'package', loading('products')),
            stat('Warehouses', count('warehouses'), 'warehouse', loading('warehouses')),
            stat('Draft moves', count('moves', "e.data.status === 'draft'"), 'arrow-left-right', loading('moves')),
            stat('Draft adjustments', count('adjustments', "e.data.status === 'draft'"), 'clipboard-check', loading('adjustments')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Inventory to recreate it.`)[0]),
          tabs([
            { value: 'moves', label: 'Stock moves', icon: 'arrow-left-right' },
            { value: 'adjustments', label: 'Adjustments', icon: 'clipboard-check' },
            { value: 'products', label: 'Products', icon: 'package' },
            { value: 'warehouses', label: 'Warehouses', icon: 'warehouse' },
          ], [
            panel('moves', [row([button('Open /stock-moves', [openFile(containers.moves.path)], undefined, 'outline', 'folder-open')]),
              browse('moves', 'move', [{ key: 'data.date', label: 'Date' }, { key: 'data.reference', label: 'Reference' }, { key: 'data.quantity', label: 'Quantity', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('adjustments', [row([button('Open /inventory-adjustments', [openFile(containers.adjustments.path)], undefined, 'outline', 'folder-open')]),
              browse('adjustments', 'adjustment', [{ key: 'data.date', label: 'Date' }, { key: 'data.countedQty', label: 'Counted', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('products', [row([button('Open /products', [openFile(containers.products.path)], undefined, 'outline', 'folder-open')]),
              browse('products', 'product', [{ key: 'data.name', label: 'Name' }, { key: 'data.sku', label: 'SKU' }, { key: 'data.unit', label: 'Unit' }, { key: 'data.category', label: 'Category' }])]),
            panel('warehouses', [row([button('Open /warehouses', [openFile(containers.warehouses.path)], undefined, 'outline', 'folder-open')]),
              browse('warehouses', 'warehouse', [{ key: 'data.name', label: 'Name' }])]),
          ]),
        ]),
      },
    },
  }
}

function stockPage() {
  // On hand per product and warehouse, from done moves only (applied adjustments contribute their corrective move).
  const levelsExpr = `(data.products || []).filter(p => p.kind === 'file' && p.data && p.data.kind === 'product').reduce((rows, p) => rows.concat((data.warehouses || []).filter(w => w.kind === 'file' && w.data && w.data.kind === 'warehouse').map(w => ({ path: p.path, code: p.data.code || p.name, product: p.data.name || '', warehouse: w.data.name || w.name, units: ${netUnits('p.path', 'm.data.toWarehouse === w.path', 'm.data.fromWarehouse === w.path')} }))), []).filter(l => l.units !== 0)`
  const totalRows = `{{ (data.totals || []).map(t => ({ path: t.path, code: t.code, product: t.product, sku: t.sku, unit: t.unit, onHand: ${display('t.units')}, reorderPoint: t.reorderPoint, state: t.hasReorder && t.units <= t.reorder ? 'Reorder' : '' })) }}`
  const levelRows = `{{ (data.levels || []).map(l => ({ path: l.path, code: l.code, product: l.product, warehouse: l.warehouse, onHand: ${display('l.units')} })) }}`
  return {
    file: 'stock.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'inventory-stock', name: 'Stock levels', description: 'On-hand stock per product and warehouse, computed from done stock moves.', icon: 'chart-column' },
      spec: {
        access: [
          productsAccess('Report on the products'),
          warehousesAccess('Break stock down per warehouse'),
          movesAccess('Sum the done stock moves'),
        ],
        data: {
          products: folder(containers.products.path, mimeTypes.product),
          warehouses: folder(containers.warehouses.path, mimeTypes.warehouse),
          moves: folder(containers.moves.path, mimeTypes.move),
          totals: { kind: 'computed', expr: totalsExpr },
          levels: { kind: 'computed', expr: levelsExpr },
        },
        tree: page([
          row([
            column([heading('Stock levels'), text('Computed from done stock moves; applied inventory adjustments count through their corrective moves. Draft moves are ignored.', 'muted')]),
            button('Inventory', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'package'),
          ], 'between'),
          ...status('products'), ...status('warehouses'), ...status('moves'),
          stats([
            stat('Products tracked', '{{ (data.totals || []).length }}', 'package', loading('products')),
            stat('At or below reorder point', `{{ ${lowExpr('data.totals || []')}.length }}`, 'triangle-alert', loading('moves')),
            stat('Done moves', count('moves', "e.data.status === 'done'"), 'arrow-left-right', loading('moves')),
          ], 3),
          tabs([
            { value: 'onhand', label: 'On hand', icon: 'package' },
            { value: 'warehouse', label: 'By warehouse', icon: 'warehouse' },
          ], [
            panel('onhand', [
              table(totalRows, [['code', 'Code'], ['product', 'Product'], ['sku', 'SKU'], ['unit', 'Unit'], ['onHand', 'On hand', 'end'], ['reorderPoint', 'Reorder point', 'end'], ['state', 'State']],
                'No products yet', true),
            ]),
            panel('warehouse', [
              table(levelRows, [['code', 'Code'], ['product', 'Product'], ['warehouse', 'Warehouse'], ['onHand', 'On hand', 'end']],
                'No stock in any warehouse yet', true),
            ]),
          ]),
        ]),
      },
    },
  }
}

/**
 * The workspace dashboard widget (`spec.widgets`): products at or below their reorder point, computed from done
 * stock moves across all warehouses.
 */
function lowStockWidget() {
  return {
    file: lowStockWidgetFile,
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'inventory-low-stock-widget', name: 'Low stock', description: 'Products at or below their reorder point for the workspace dashboard.', icon: 'triangle-alert' },
      spec: {
        access: [productsAccess('Show the products and their reorder points'), movesAccess('Sum the done stock moves')],
        data: {
          products: folder(containers.products.path, mimeTypes.product),
          moves: folder(containers.moves.path, mimeTypes.move),
          low: { kind: 'computed', expr: lowExpr(totalsExpr) },
        },
        tree: [column([
          row([
            column([heading('Low stock', 3), text('{{ (data.low || []).length }} product(s) at or below their reorder point', 'muted')]),
            button('Stock levels', [openFile(`${installRoot}/canvas/stock.page.yaml`)], undefined, 'ghost', 'chart-column'),
          ], 'between'),
          status('products')[0], status('moves')[0],
          { ...text('Loading…', 'muted'), rules: { visible: "data.$products.status === 'loading' || data.$moves.status === 'loading'" } },
          table(`{{ (data.low || []).map(t => ({ path: t.path, product: t.product, sku: t.sku, onHand: ${display('t.units')}, reorderPoint: t.reorderPoint })) }}`,
            [['product', 'Product'], ['sku', 'SKU'], ['onHand', 'On hand', 'end'], ['reorderPoint', 'Reorder point', 'end']], 'Nothing to reorder', true),
        ], 2)],
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), stockPage(), lowStockWidget(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
