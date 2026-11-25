// Generates the Products Canvas documents: the product form and the launch page listing the catalogue. Other apps
// read these product files; they change them only through Products' API (api.yaml).
import {
  archived, badge, baseActions, boundForm, browser, button, folder, grid, heading, iconName, openFile, page, panel,
  projectRegistration, recordButtons, recordHeader, row, sectionCards, stat, stats, status, table, tabs, text,
  archivedAlert, pageHeader, appNavigation,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, inventory, mimeTypes, schemaId } from './contracts.mjs'
import { entities, postScriptPath } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Products schemas and run its scripts' }
const productsAccess = reason => ({ path: containers.products.path, reason })

// Stock arithmetic runs in the Canvas expression language, which has only floating point numbers, so quantities are
// summed as integer ten-thousandths (exact for every quantity a file can hold) and only divided for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const doneMoves = "(data.moves || []).filter(m => m.kind === 'file' && m.data && m.data.kind === 'move' && m.data.status === 'done' && m.data.product === ctx.file.path)"
const onHand = `(${doneMoves}.reduce((s, m) => s + (m.data.toWarehouse ? ${units('m.data.quantity')} : 0) - (m.data.fromWarehouse ? ${units('m.data.quantity')} : 0), 0) / 10000)`

function productForm() {
  const entity = entities.product
  const readOnly = archived
  const history = `(data.moves || []).filter(m => m.kind === 'file' && m.data && m.data.kind === 'move' && m.data.product === ctx.file.path).map(m => ({ path: m.path, date: m.data.date || '', move: m.data.code || m.name, reference: m.data.reference || '', quantity: m.data.quantity || '', status: m.data.status || '' })).sort((a, b) => a.date < b.date ? 1 : -1)`
  const header = recordHeader(
    `{{ form.values.name || 'New product' }}`,
    [
      badge("{{ form.values.type === 'service' ? 'Service' : 'Goods' }}", 'neutral'),
      badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `Product {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [recordButtons('false')],
  )
  const overview = [grid(sectionCards(entity.sections, readOnly))]
  const stock = [
    // Inventory keeps stock moves; without it there is nothing to show.
    { ...text('Install Inventory to track stock of this product.', 'muted'), rules: { visible: "data.$moves.status === 'error'" } },
    stats([
      stat('On hand (done moves)', `{{ ${onHand} }}`, 'package', "{{ data.$moves.status === 'loading' }}"),
      stat('Reorder point', "{{ form.values.reorderPoint || '—' }}", 'triangle-alert'),
    ], 3),
    table(`{{ ${history} }}`, [['date', 'Date'], ['move', 'Move'], ['reference', 'Reference'], ['quantity', 'Quantity', 'end'], ['status', 'Status']],
      'No stock moves use this product yet', true),
  ]
  return {
    file: 'product.form.yaml',
    document: boundForm({
      name: 'products-product', displayName: 'Product', description: 'View and edit a product of the shared catalogue.',
      icon: iconName(entity.icon), mime: mimeTypes.product, schemaId: schemaId('product'), schemaSource: `${installRoot}/schemas/product.schema.json`,
      access: [
        { path: inventory.moves, reason: 'Show the stock moves of this product (when Inventory is installed)' },
        schemaAccess,
      ],
      data: { moves: folder(inventory.moves, inventory.moveMime) },
      tree: [
        header,
        ...status('record'),
        archivedAlert(entity.singular),
        tabs([
          { value: 'overview', label: 'Overview', icon: iconName(entity.icon) },
          { value: 'stock', label: 'Stock', icon: 'boxes' },
        ], [panel('overview', overview), panel('stock', stock)]),
      ],
      actions: { ...baseActions },
    }),
  }
}

const shared = `e.kind === 'file' && e.data && e.data.kind === 'product' && e.data.$schema === '${schemaId('product')}'`
// Product files Sales or Inventory wrote before Products, waiting to be adopted into the shared format.
const earlier = `e.kind === 'file' && e.data && e.data.kind === 'product' && e.data.$schema !== '${schemaId('product')}'`
const count = filter => `{{ (data.products || []).filter(e => ${filter}).length }}`
const loading = "{{ data.$products.status === 'loading' }}"

function homePage() {
  const rows = `{{ (data.products || []).filter(e => ${shared} && (state.showarchived || e.data.state !== 'archived')).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', type: e.data.type || 'goods', sku: e.data.sku || '', unit: e.data.unit || '', category: e.data.category || '', listPrice: e.data.listPrice || '', reorderPoint: e.data.reorderPoint || '' })).sort((a, b) => a.code < b.code ? -1 : 1) }}`
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'products-home', name: 'Products', description: 'The shared product catalogue.', icon: 'package' },
      spec: {
        access: [productsAccess('List the products'), schemaAccess],
        permissions: ['execution.run'],
        // Every product file, in either format, so earlier Sales or Inventory products can be adopted.
        data: { products: folder(containers.products.path) },
        state: { showarchived: false },
        tree: page([
          pageHeader(
            [heading('Products'), text('One catalogue for every app. Sales quotes these products, Inventory stocks them and Manufacturing builds them. Add a product with New in /products.', 'muted')],
            [row([button('Open /products', [openFile(containers.products.path)], undefined, 'outline', 'folder-open')])],
          ),
          stats([
            stat('Products', count(`${shared} && e.data.state !== 'archived'`), 'package', loading),
            stat('Goods', count(`${shared} && e.data.state !== 'archived' && e.data.type !== 'service'`), 'box', loading),
            stat('Services', count(`${shared} && e.data.state !== 'archived' && e.data.type === 'service'`), 'hand-helping', loading),
          ], 3),
          ...status('products', `The ${containers.products.path} folder could not be read. Reinstall Products to recreate it.`),
          {
            type: 'canvas.alert',
            props: {
              tone: 'warning', title: `${count(earlier)} product(s) from before Products`,
              text: 'Sales or Inventory kept these in their own format. Adopt them so every app sees them; their codes and paths stay the same.',
            },
            rules: { visible: `(data.products || []).some(e => ${earlier})` },
          },
          {
            ...button('Adopt earlier products', [
              { confirm: { title: 'Adopt earlier products', message: 'Rewrite the earlier Sales and Inventory product files in the shared format? Codes, paths and references stay the same.' } },
              { 'run-script': { file: postScriptPath, timeout: 300, parameters: { operation: 'adopt-products' }, assign: 'adopted' } },
              { 'refresh-source': { source: 'products' } },
              { toast: { message: "{{ (state.adopted && state.adopted.message) || 'Done' }}", variant: 'success' } },
            ], undefined, 'outline', 'replace'),
            rules: { visible: `(data.products || []).some(e => ${earlier})` },
          },
          { type: 'canvas.form.switch', props: { label: 'Show archived products', value: '{{ state.showarchived }}' } },
          table(rows, [['code', 'Code'], ['name', 'Name'], ['type', 'Type'], ['sku', 'SKU'], ['unit', 'Unit'], ['category', 'Category'],
            ['listPrice', 'List price', 'end'], ['reorderPoint', 'Reorder point', 'end']], 'No products yet. Use New in /products.', true),
          browser(containers.products.path, mimeTypes.product, [
            { key: 'name', label: 'Code' }, { key: 'data.name', label: 'Name' }, { key: 'data.sku', label: 'SKU' }, { key: 'data.category', label: 'Category' },
          ], 'No products yet. Use New in /products.'),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), productForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot)
}
