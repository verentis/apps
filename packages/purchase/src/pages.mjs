// Generates the Purchase Canvas documents: one bound form per record kind, the settings form, the purchases
// summary page and the vendor and purchase order list pages. Confirming and receiving (validation, totals,
// vendor bill drafts, immutability) are done by the order script the forms run; the forms only lock what the
// script has confirmed or received.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row,
  appOperationsSource, offers, scriptAction, sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['confirmed', 'received'], warning: ['draft', 'sent'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Purchase schemas and run the order script' }
const idle = 'form.saving || form.dirty'
// Drafts and sent orders (RFQs) stay editable; confirming locks the order.
const editable = "(!form.values.status || form.values.status === 'draft' || form.values.status === 'sent')"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`

const vendorSources = {
  vendors: folder(containers.vendors.path, mimeTypes.vendor),
  vendoroptions: { kind: 'computed', expr: options('vendors', "e.data.name || ''") },
}

// A draft's total, estimated in cents the way the script computes it (each line rounded) for display while editing.
const lineNet = "Math.round(Number(l.quantity || 0) * Math.round(Number(l.unitPrice || 0) * 100))"
const estimate = `(form.values.lines || []).reduce((s, l) => s + ${lineNet}, 0)`

/** Kind-specific data, access, actions, header buttons and links of a record form. */
function recordExtras(kind) {
  if (kind === 'vendor') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], links: [], actions: {} }
  }
  return {
    access: [{ path: containers.vendors.path, reason: 'Choose the vendor to buy from' }, schemaAccess],
    data: { ...vendorSources, ...appOperationsSource },
    notices: [
      stats([
        stat('Lines', '{{ (form.values.lines || []).length }}', 'list'),
        stat('Expected', "{{ form.values.expectedDate || '—' }}", 'calendar'),
        stat('Total {{ form.values.currency }}', `{{ form.values.total || (${estimate} / 100).toFixed(2) }}`, 'receipt'),
      ], 3),
      { ...text('Estimated while drafting; confirming computes the exact total.', 'muted'), rules: { visible: '!form.values.total' } },
      // Receiving: count each line as the goods arrive. The order is locked once confirmed, so each count is written
      // to the order at once; Receive then records the delivery and drafts the vendor bill.
      { ...card('Receive goods', [{
        type: 'canvas.repeat',
        props: { items: '{{ form.values.lines || [] }}', layout: 'list', emptyText: 'No lines' },
        children: [{
          type: 'canvas.form.counter',
          props: {
            label: "{{ item.description || 'Line ' + (index + 1) }}",
            value: '{{ Number(item.received || 0) }}', target: '{{ Number(item.quantity || 0) }}', min: 0,
          },
          on: { update: [
            { 'patch-record': { path: '{{ ctx.file.path }}', values: { lines: { $expr: "(form.values.lines || []).map((line, position) => position === index ? withPath(line, 'received', String(event)) : line)" }, updatedAt: '{{ Date() }}' } } },
            { 'refresh-source': { source: 'record' } },
          ] },
        }],
      }], 'Count what arrived against what was ordered. Lines left uncounted are taken as received in full.'), rules: { visible: "form.values.status === 'confirmed' && !form.dirty" } },
    ],
    buttons: [
      button('Mark sent', 'mark-sent', { visible: `form.values.status === 'draft' && !(${archived})`, disabled: idle }, 'outline', 'send'),
      button('Confirm', 'confirm', { visible: `${editable} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
      button('Receive', 'receive', { visible: "form.values.status === 'confirmed'", disabled: idle }, undefined, 'package-check'),
      button('Cancel order', 'cancel', { visible: `${editable} && !(${archived})`, disabled: idle }, 'ghost', 'x'),
      // Received but no vendor bill yet (Invoicing arrived later, or drafting failed): ask Invoicing again.
      button('Draft vendor bill', 'draft-bill', { visible: `form.values.status === 'received' && !(form.values.bill && form.values.bill.path) && ${offers('invoicing', 'create-draft-invoice')}`, disabled: idle }, 'outline', 'file-text'),
    ],
    links: [
      linkButton('Vendor', 'form.values.vendor', 'building-2'),
      linkButton('Vendor bill', 'form.values.bill && form.values.bill.path', 'file-text'),
    ],
    actions: {
      'mark-sent': { steps: [
        { confirm: { title: 'Mark sent', message: 'Mark this purchase order as sent to the vendor? It stays editable until it is confirmed.' } },
        { 'patch-form': { values: { status: 'sent', updatedAt: '{{ Date() }}' } } },
        { save: {} },
        { toast: { message: 'Marked sent', variant: 'success' } },
      ] },
      confirm: scriptAction(postScriptPath, 'confirm-order', {
        confirm: { title: 'Confirm order', message: 'Confirm this purchase order with its vendor? Confirmed orders cannot be edited, only received or archived.' },
      }),
      receive: scriptAction(postScriptPath, 'receive-order', {
        confirm: { title: 'Receive order', message: 'Mark this purchase order as received? When Invoicing is installed, it drafts the vendor bill.' },
      }),
      'draft-bill': scriptAction(postScriptPath, 'receive-order', {}),
      cancel: { steps: [
        { confirm: { title: 'Cancel order', message: 'Cancel this purchase order? Cancelled orders cannot be confirmed or received.' } },
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
  const locked = entity.status ? `!${editable}` : 'false'
  const readOnly = entity.status ? `${archived} || (${locked})` : archived
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
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `purchase-${kind}`, displayName: `Purchase ${entity.singular.toLowerCase()}`,
      description: `View and edit a Purchase ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access,
      data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'purchase-settings', displayName: 'Purchase settings', description: 'Edit the Purchase settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        pageHeader(
          [heading('Purchase settings'), text('Defaults new purchase orders start with. Number prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
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

const orderRows = `(data.orders || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, vendorName: e.data.vendorName || '', reference: e.data.reference || '', orderDate: e.data.orderDate || '', expectedDate: e.data.expectedDate || '', status: e.data.status || 'draft', total: e.data.total ? [e.data.currency, e.data.total].filter(Boolean).join(' ') : '', open: e.data.status === 'confirmed', units: ${units('e.data.total')} }))`
const orderSources = {
  orders: folder(containers.orders.path, mimeTypes.order),
  orderrows: { kind: 'computed', expr: orderRows },
}
const onOrder = `{{ ${display(`(data.orderrows || []).filter(r => r.open).reduce((s, r) => s + r.units, 0)`)} }}`

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'purchase-home', name: 'Purchase', description: 'Purchases summary.', icon: 'shopping-cart' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: Object.values(containers).map(container => ({ path: container.path, reason: `List ${container.path.slice(1).split('-').join(' ')}` })),
        data: { ...vendorSources, ...orderSources },
        tree: page([
          pageHeader(
            [heading('Purchase'), text('Vendors and purchase orders are files in your workspace. Draft an order in its folder, send it to the vendor, then confirm and receive it from its form.', 'muted')], [
            row([
              button('Vendors', [openFile(`${installRoot}/canvas/vendors.page.yaml`)], undefined, 'outline', 'building-2'),
              button('Purchase orders', [openFile(`${installRoot}/canvas/orders.page.yaml`)], undefined, 'outline', 'shopping-cart'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Vendors', count('vendors'), 'building-2', loading('vendors')),
            stat('Draft orders', count('orders', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('orders')),
            stat('Awaiting receipt', count('orders', "e.data.status === 'confirmed'"), 'package', loading('orders')),
            stat('On order', onOrder, 'receipt', loading('orders')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Purchase to recreate it.`)[0]),
          tabs([
            { value: 'orders', label: 'Purchase orders', icon: 'shopping-cart' },
            { value: 'vendors', label: 'Vendors', icon: 'building-2' },
          ], [
            panel('orders', [row([button('Open /purchase-orders', [openFile(containers.orders.path)], undefined, 'outline', 'folder-open')]),
              browse('orders', 'order', [{ key: 'data.vendorName', label: 'Vendor' }, { key: 'data.orderDate', label: 'Ordered' }, { key: 'data.expectedDate', label: 'Expected' }, { key: 'data.total', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('vendors', [row([button('Open /vendors', [openFile(containers.vendors.path)], undefined, 'outline', 'folder-open')]),
              browse('vendors', 'vendor', [{ key: 'data.name', label: 'Name' }, { key: 'data.contactName', label: 'Contact' }, { key: 'data.email', label: 'Email' }, { key: 'data.paymentTermsDays', label: 'Terms (days)', align: 'end' }])]),
          ]),
        ]),
      },
    },
  }
}

function vendorsPage() {
  const rows = `{{ (data.vendors || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', contact: e.data.contactName || '', email: e.data.email || '', phone: e.data.phone || '', terms: e.data.paymentTermsDays })) }}`
  return {
    file: 'vendors.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'purchase-vendors', name: 'Vendors', description: 'The vendors you buy from.', icon: 'building-2' },
      spec: {
        access: [{ path: containers.vendors.path, reason: 'List vendors' }],
        data: vendorSources,
        tree: page([
          pageHeader(
            [heading('Vendors'), text('Who you buy from, with their contact details and payment terms.', 'muted')], [
            row([
              button('Open /vendors', [openFile(containers.vendors.path)], undefined, 'outline', 'folder-open'),
              button('Purchase', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'shopping-cart'),
            ]),
          ]),
          ...status('vendors'),
          table(rows, [['code', 'Vendor'], ['name', 'Name'], ['contact', 'Contact'], ['email', 'Email'], ['phone', 'Phone'], ['terms', 'Terms (days)', 'end']],
            'No vendors yet. Use New in /vendors.', true),
        ]),
      },
    },
  }
}

function ordersPage() {
  const rows = `{{ (data.orderrows || []).filter(r => state.showclosed || (r.status !== 'received' && r.status !== 'cancelled')) }}`
  return {
    file: 'orders.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'purchase-orders', name: 'Purchase orders', description: 'Purchase orders by status.', icon: 'shopping-cart' },
      spec: {
        access: [{ path: containers.orders.path, reason: 'List purchase orders' }],
        data: orderSources,
        state: { showclosed: false },
        tree: page([
          pageHeader(
            [heading('Purchase orders'), text('RFQs and purchase orders. Confirmed orders are locked until they are received.', 'muted')], [
            row([
              button('Open /purchase-orders', [openFile(containers.orders.path)], undefined, 'outline', 'folder-open'),
              button('Purchase', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'shopping-cart'),
            ]),
          ]),
          ...status('orders'),
          stats([
            stat('Draft', count('orders', "(e.data.status || 'draft') === 'draft'"), 'file-pen', loading('orders')),
            stat('Sent', count('orders', "e.data.status === 'sent'"), 'send', loading('orders')),
            stat('Awaiting receipt', count('orders', "e.data.status === 'confirmed'"), 'package', loading('orders')),
            stat('On order', onOrder, 'receipt', loading('orders')),
          ]),
          { type: 'canvas.form.switch', props: { label: 'Show received and cancelled orders', value: '{{ state.showclosed }}' } },
          table(rows, [['code', 'Order'], ['vendorName', 'Vendor'], ['reference', 'Reference'], ['orderDate', 'Ordered'],
            ['expectedDate', 'Expected'], ['total', 'Total', 'end'], ['status', 'Status']], 'No open purchase orders', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), vendorsPage(), ordersPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
