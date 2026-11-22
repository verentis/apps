// Generates the Sales Canvas documents: one bound form per record kind, the settings form, the launch page,
// the quotation and order list pages and the sales summary page. Confirming (totals, the sales order, the
// optional draft invoice, immutability) is done by the confirm script the quotation form runs; the forms only
// lock what the script has confirmed.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row,
  scriptAction, sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, crm, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['confirmed', 'delivered'], warning: ['draft', 'pending'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Sales schemas and run the confirm script' }
const productSources = {
  products: folder(containers.products.path, mimeTypes.product),
  productoptions: { kind: 'computed', expr: options('products', "e.data.name || ''") },
}
const quotationSources = {
  quotations: folder(containers.quotations.path, mimeTypes.quotation),
  quotationoptions: { kind: 'computed', expr: options('quotations', "((e.data.customer && e.data.customer.name) || '') + ' · ' + (e.data.date || '')") },
}
const idle = 'form.saving || form.dirty'
const draftish = "(form.values.status === 'draft' || form.values.status === 'sent')"
const locked = "form.values.status === 'confirmed'"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`

// A draft's totals, estimated in cents the way the script computes them (each line rounded) for display while editing.
const lineNet = "Math.round(Number(l.quantity || 0) * Math.round(Number(l.unitPrice || 0) * 100))"
const lineDiscount = `Math.round(${lineNet} * Number(l.discount || 0) / 100)`
const estimate = {
  subtotal: `(form.values.lines || []).reduce((s, l) => s + ${lineNet}, 0)`,
  discount: `(form.values.lines || []).reduce((s, l) => s + ${lineDiscount}, 0)`,
}
function totalsStats() {
  const cents = value => `(${value} / 100).toFixed(2)`
  const shown = (key, estimated) => `{{ form.values.totals ? form.values.totals.${key} : ${cents(estimated)} }}`
  return [
    stats([
      stat('Subtotal', shown('subtotal', estimate.subtotal), 'sigma'),
      stat('Discount', shown('discount', estimate.discount), 'percent'),
      stat('Total {{ form.values.currency }}', shown('total', `(${estimate.subtotal} - ${estimate.discount})`), 'receipt'),
    ], 3),
    { ...text('Estimated while drafting; confirming computes the exact totals.', 'muted'), rules: { visible: '!form.values.totals' } },
  ]
}

const fromCrm = field => `(e.data.${field} || '')`
const crmAddress = field => `((e.data.address || {}).${field} || '')`
const copyCustomer = `(data.companies || []).concat(data.contacts || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.customerRef).map(e => ({ name: e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' '), legalName: ${fromCrm('legalName')}, email: ${fromCrm('email')}, phone: ${fromCrm('phone')}, taxIdentifier: ${fromCrm('taxIdentifier')}, address: { lines: (e.data.address || {}).lines || [], city: ${crmAddress('city')}, region: ${crmAddress('region')}, postalCode: ${crmAddress('postalCode')}, country: ${crmAddress('country')} } }))[0] || form.values.customer`

/** Kind-specific data, access, actions, header buttons and lock of a record form. */
function recordExtras(kind) {
  if (kind === 'quotation') {
    return {
      locked,
      access: [
        { path: crm.customers, reason: 'Offer CRM customers to quote (when CRM is installed)' },
        { path: containers.products.path, reason: 'Offer products on quotation lines' },
      ],
      data: {
        companies: folder(crm.customers, crm.companyMime),
        contacts: folder(crm.customers, crm.contactMime),
        customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
        ...productSources,
      },
      notices: totalsStats(),
      buttons: [
        button('Copy details', 'copy-customer', { visible: `${draftish} && !!form.values.customerRef`, disabled: `form.saving || ${archived}` }, 'outline', 'copy'),
        button('Mark sent', 'mark-sent', { visible: `form.values.status === 'draft' && !(${archived})`, disabled: 'form.saving || form.invalid' }, 'outline', 'send'),
        button('Confirm', 'confirm', { visible: `${draftish} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
        button('Cancel', 'cancel', { visible: `${draftish} && !(${archived})`, disabled: 'form.saving' }, 'ghost', 'x'),
        button('Reopen', 'reopen', { visible: `form.values.status === 'cancelled' && !(${archived})`, disabled: 'form.saving' }, 'outline', 'rotate-ccw'),
      ],
      links: [
        linkButton('Sales order', 'form.values.order && form.values.order.path', 'package-check'),
        linkButton('Invoice', 'form.values.invoice && form.values.invoice.path', 'file-text'),
        linkButton('CRM customer', 'form.values.customerRef', 'building-2'),
      ],
      actions: {
        'copy-customer': { steps: [{ 'patch-form': { values: { customer: `{{ ${copyCustomer} }}` } } }] },
        'mark-sent': { steps: [
          { 'patch-form': { values: { status: 'sent', updatedAt: '{{ Date() }}' } } },
          { save: {} },
          { toast: { message: 'Marked sent', variant: 'success' } },
        ] },
        confirm: scriptAction(postScriptPath, 'confirm-quotation', { confirm: { title: 'Confirm quotation', message: 'Confirm this quotation and create its sales order? Confirmed quotations cannot be edited.' } }),
        cancel: { steps: [
          { confirm: { title: 'Cancel quotation', message: 'Cancel this quotation? It can be reopened later.' } },
          { 'patch-form': { values: { status: 'cancelled', updatedAt: '{{ Date() }}' } } },
          { save: {} },
          { toast: { message: 'Cancelled', variant: 'success' } },
        ] },
        reopen: { steps: [
          { 'patch-form': { values: { status: 'draft', updatedAt: '{{ Date() }}' } } },
          { save: {} },
          { toast: { message: 'Reopened as a draft', variant: 'success' } },
        ] },
      },
    }
  }
  if (kind === 'order') {
    return {
      locked: 'false',
      access: [{ path: containers.quotations.path, reason: 'Link back to the quotation this order came from' }],
      data: quotationSources,
      notices: [{
        ...stats([
          stat('Subtotal', '{{ form.values.totals && form.values.totals.subtotal }}', 'sigma'),
          stat('Discount', '{{ form.values.totals && form.values.totals.discount }}', 'percent'),
          stat('Total {{ form.values.currency }}', '{{ form.values.totals && form.values.totals.total }}', 'receipt'),
        ], 3),
        rules: { visible: '!!form.values.totals' },
      }],
      buttons: [],
      links: [linkButton('Quotation', 'form.values.quotation', 'file-text')],
      actions: {},
    }
  }
  return { locked: 'false', access: [], data: {}, notices: [], buttons: [], links: [], actions: {} }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const lower = entity.singular.toLowerCase()
  const displayName = lower.startsWith('sales') ? entity.singular : `Sales ${lower}`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${lower}' }}`),
        ...(entity.status
          ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })]
          : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...extras.buttons, recordButtons(extras.locked)]),
  ], 'between')
  const tree = [
    header,
    ...status('record'),
    badge(`This ${lower} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...(extras.links.length ? [row(extras.links)] : []),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `sales-${kind}`, displayName,
      description: `View and edit a ${displayName.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'sales-settings', displayName: 'Sales settings', description: 'Edit the Sales settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        row([
          column([heading('Sales settings'), text('Defaults for new quotations and sales orders. Number prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const count = (source, filter = 'true') => `{{ (data.${source} || []).filter(e => ${active} && (${filter})).length }}`
const loading = source => `{{ data.$${source}.status === 'loading' }}`

const confirmedValue = `(data.quotations || []).filter(e => ${active} && e.data.status === 'confirmed' && e.data.totals).reduce((s, e) => s + ${units('e.data.totals.total')}, 0)`
// Open quotations have no exact totals yet, so the pipeline is estimated from their lines.
const pipelineValue = `(data.quotations || []).filter(e => ${active} && (e.data.status === 'draft' || e.data.status === 'sent')).reduce((s, e) => s + (e.data.lines || []).reduce((t, l) => t + Math.round(Number(l.quantity || 0) * Number(l.unitPrice || 0) * (100 - Number(l.discount || 0)) * 100), 0), 0)`
const orderValue = `(data.orders || []).filter(e => ${active} && e.data.totals).reduce((s, e) => s + ${units('e.data.totals.total')}, 0)`

const quotationRow = "({ path: e.path, code: e.data.code || e.name, customer: (e.data.customer && e.data.customer.name) || '', date: e.data.date, status: e.data.status, total: (e.data.totals && e.data.totals.total) || '' })"
const orderRow = "({ path: e.path, code: e.data.code || e.name, customer: (e.data.customer && e.data.customer.name) || '', date: e.data.date, delivery: e.data.deliveryStatus, total: (e.data.totals && e.data.totals.total) || '' })"

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'sales-home', name: 'Sales', description: 'Sales overview.', icon: 'package' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: Object.values(containers).map(container => ({ path: container.path, reason: `List ${container.path.slice(1).split('-').join(' ')}` })),
        data: {
          products: folder(containers.products.path, mimeTypes.product),
          quotations: folder(containers.quotations.path, mimeTypes.quotation),
          orders: folder(containers.orders.path, mimeTypes.order),
        },
        tree: page([
          row([
            column([heading('Sales'), text('Products, quotations and sales orders are files in your workspace. Draft quotations in their folder, then confirm them from their forms into sales orders.', 'muted')]),
            row([
              button('Quotations', [openFile(`${installRoot}/canvas/quotations.page.yaml`)], undefined, 'outline', 'file-text'),
              button('Sales orders', [openFile(`${installRoot}/canvas/orders.page.yaml`)], undefined, 'outline', 'package-check'),
              button('Summary', [openFile(`${installRoot}/canvas/summary.page.yaml`)], undefined, 'outline', 'chart-no-axes-combined'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Products', count('products'), 'package', loading('products')),
            stat('Open quotations', count('quotations', "e.data.status === 'draft' || e.data.status === 'sent'"), 'file-pen', loading('quotations')),
            stat('Confirmed value', `{{ ${display(confirmedValue)} }}`, 'receipt', loading('quotations')),
            stat('Undelivered orders', count('orders', "e.data.deliveryStatus !== 'delivered'"), 'truck', loading('orders')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Sales to recreate it.`)[0]),
          tabs([
            { value: 'products', label: 'Products', icon: 'package' },
            { value: 'quotations', label: 'Quotations', icon: 'file-text' },
            { value: 'orders', label: 'Sales orders', icon: 'package-check' },
          ], [
            panel('products', [row([button('Open /products', [openFile(containers.products.path)], undefined, 'outline', 'folder-open')]),
              browse('products', 'product', [{ key: 'data.name', label: 'Name' }, { key: 'data.unit', label: 'Unit' }, { key: 'data.listPrice', label: 'List price', align: 'end' }])]),
            panel('quotations', [row([button('Open /quotations', [openFile(containers.quotations.path)], undefined, 'outline', 'folder-open')]),
              browse('quotations', 'quotation', [{ key: 'data.customer.name', label: 'Customer' }, { key: 'data.date', label: 'Date' }, { key: 'data.totals.total', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('orders', [row([button('Open /sales-orders', [openFile(containers.orders.path)], undefined, 'outline', 'folder-open')]),
              browse('orders', 'order', [{ key: 'data.customer.name', label: 'Customer' }, { key: 'data.date', label: 'Date' }, { key: 'data.totals.total', label: 'Total', align: 'end' }, { key: 'data.deliveryStatus', label: 'Delivery' }])]),
          ]),
        ]),
      },
    },
  }
}

function quotationsPage() {
  const rows = `{{ (data.quotations || []).filter(e => ${active} && (state.showcancelled || e.data.status !== 'cancelled')).map(e => ${quotationRow}) }}`
  return {
    file: 'quotations.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'sales-quotations', name: 'Quotations', description: 'Quotations by status.', icon: 'file-text' },
      spec: {
        access: [{ path: containers.quotations.path, reason: 'List quotations by status' }],
        data: { quotations: folder(containers.quotations.path, mimeTypes.quotation) },
        state: { showcancelled: false },
        tree: page([
          row([
            column([heading('Quotations'), text('Draft, sent and confirmed quotations. Confirming a quotation creates its sales order.', 'muted')]),
            button('Sales', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'package'),
          ], 'between'),
          ...status('quotations'),
          stats([
            stat('Draft', count('quotations', "e.data.status === 'draft'"), 'file-pen', loading('quotations')),
            stat('Sent', count('quotations', "e.data.status === 'sent'"), 'send', loading('quotations')),
            stat('Confirmed', count('quotations', "e.data.status === 'confirmed'"), 'check', loading('quotations')),
            stat('Confirmed value', `{{ ${display(confirmedValue)} }}`, 'receipt', loading('quotations')),
          ]),
          { type: 'canvas.form.switch', props: { label: 'Show cancelled quotations', value: '{{ state.showcancelled }}' } },
          table(rows, [['code', 'Quotation'], ['customer', 'Customer'], ['date', 'Date'], ['status', 'Status'], ['total', 'Total', 'end']], 'No quotations yet', true),
        ]),
      },
    },
  }
}

function ordersPage() {
  const rows = `{{ (data.orders || []).filter(e => ${active} && (state.showdelivered || e.data.deliveryStatus !== 'delivered')).map(e => ${orderRow}) }}`
  return {
    file: 'orders.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'sales-orders', name: 'Sales orders', description: 'Sales orders by delivery status.', icon: 'package-check' },
      spec: {
        access: [{ path: containers.orders.path, reason: 'List sales orders by delivery status' }],
        data: { orders: folder(containers.orders.path, mimeTypes.order) },
        state: { showdelivered: false },
        tree: page([
          row([
            column([heading('Sales orders'), text('What confirmed quotations became, tracked by delivery status.', 'muted')]),
            button('Sales', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'package'),
          ], 'between'),
          ...status('orders'),
          stats([
            stat('Pending', count('orders', "e.data.deliveryStatus === 'pending'"), 'hourglass', loading('orders')),
            stat('Partial', count('orders', "e.data.deliveryStatus === 'partial'"), 'truck', loading('orders')),
            stat('Delivered', count('orders', "e.data.deliveryStatus === 'delivered'"), 'package-check', loading('orders')),
            stat('Order book', `{{ ${display(orderValue)} }}`, 'receipt', loading('orders')),
          ]),
          { type: 'canvas.form.switch', props: { label: 'Show delivered orders', value: '{{ state.showdelivered }}' } },
          table(rows, [['code', 'Order'], ['customer', 'Customer'], ['date', 'Date'], ['delivery', 'Delivery'], ['total', 'Total', 'end']], 'No sales orders yet', true),
        ]),
      },
    },
  }
}

function summaryPage() {
  const confirmed = `{{ (data.quotations || []).filter(e => ${active} && e.data.status === 'confirmed').map(e => ${quotationRow}) }}`
  const open = `{{ (data.orders || []).filter(e => ${active} && e.data.deliveryStatus !== 'delivered').map(e => ${orderRow}) }}`
  return {
    file: 'summary.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'sales-summary', name: 'Sales summary', description: 'Pipeline, confirmed value and open deliveries.', icon: 'chart-no-axes-combined' },
      spec: {
        access: [
          { path: containers.quotations.path, reason: 'Sum the quotation pipeline and confirmed value' },
          { path: containers.orders.path, reason: 'Sum the order book and open deliveries' },
        ],
        data: {
          quotations: folder(containers.quotations.path, mimeTypes.quotation),
          orders: folder(containers.orders.path, mimeTypes.order),
        },
        tree: page([
          row([
            column([heading('Sales summary'), text('Open quotations are estimated from their lines; confirmed quotations and sales orders use their exact totals.', 'muted')]),
            button('Sales', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'package'),
          ], 'between'),
          ...status('quotations'),
          ...status('orders'),
          stats([
            stat('Open quotations', count('quotations', "e.data.status === 'draft' || e.data.status === 'sent'"), 'file-pen', loading('quotations')),
            stat('Pipeline (estimated)', `{{ ${display(pipelineValue)} }}`, 'trending-up', loading('quotations')),
            stat('Confirmed value', `{{ ${display(confirmedValue)} }}`, 'receipt', loading('quotations')),
            stat('Order book', `{{ ${display(orderValue)} }}`, 'package-check', loading('orders')),
          ]),
          card('Confirmed quotations', [table(confirmed, [['code', 'Quotation'], ['customer', 'Customer'], ['date', 'Date'], ['total', 'Total', 'end']], 'Nothing confirmed yet', true)]),
          card('Open deliveries', [table(open, [['code', 'Order'], ['customer', 'Customer'], ['date', 'Date'], ['delivery', 'Delivery'], ['total', 'Total', 'end']], 'Nothing to deliver', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), quotationsPage(), ordersPage(), summaryPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
