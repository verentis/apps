// Generates the Rental Canvas documents: one bound form per record kind, the settings form, the launch page,
// the bookings list, the availability summary and the revenue summary. Confirming, picking up, returning and
// cancelling (totals, availability, late fees, the optional draft invoice, immutability) are done by the booking
// script the booking form runs; the forms only lock what the script has confirmed.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, linkButton, openFile, options, page, panel, projectRegistration, recordButtons, row,
  appOperationsSource, offers, scriptAction, sectionCards, stat, stats, status, table, tabs, text, toneExpression, recordHeader, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, crm, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['confirmed', 'returned', 'available'], warning: ['draft', 'picked-up'], danger: ['cancelled', 'unavailable'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Rental schemas and run the booking script' }
const productSources = {
  products: folder(containers.products.path, mimeTypes.product),
  productoptions: { kind: 'computed', expr: options('products', "(e.data.name || '') + ' · ' + (e.data.dailyRate || '') + '/day'") },
}
const idle = 'form.saving || form.dirty'
const draft = "form.values.status === 'draft'"
const confirmed = "form.values.status === 'confirmed'"
const pickedUp = "form.values.status === 'picked-up'"
const locked = "['confirmed', 'picked-up', 'returned'].includes(form.values.status)"

// Canvas expressions only have floating point numbers, so amounts are summed as integer ten-thousandths (exact for
// every amount a file holds) and divided only for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000).toFixed(2)`

const copyName = `(data.companies || []).concat(data.contacts || []).filter(e => e.kind === 'file' && e.data && e.path === form.values.customerRef).map(e => e.data.name || [e.data.givenName, e.data.familyName].filter(Boolean).join(' '))[0] || form.values.customerName`

/** Kind-specific data, access, actions, header buttons and lock of a record form. */

function recordExtras(kind) {
  if (kind === 'booking') {
    const returnVisible = { visible: pickedUp }
    return {
      locked,
      access: [
        { path: crm.customers, reason: 'Offer CRM customers to book for (when CRM is installed)' },
        { path: containers.products.path, reason: 'Offer rental products and their daily rates' },
      ],
      data: {
        companies: folder(crm.customers, crm.companyMime),
        contacts: folder(crm.customers, crm.contactMime),
        customeroptions: { kind: 'computed', expr: `${options('companies', "e.data.name || ''")}.concat(${options('contacts', "[e.data.givenName, e.data.familyName].filter(Boolean).join(' ')")})` },
        ...productSources,
        ...appOperationsSource,
      },
      state: { returndate: '' },
      notices: [
        { ...stats([
          stat('Total', '{{ form.values.total }}', 'receipt'),
          stat('Deposit', "{{ form.values.deposit || '0.00' }}", 'piggy-bank'),
          stat('Late fee', "{{ form.values.lateFee || '—' }}", 'alarm-clock'),
        ], 3), rules: { visible: '!!form.values.total' } },
        { ...text('Confirming checks availability and computes the exact total (days × daily rate × quantity).', 'muted'), rules: { visible: `${draft}` } },
        { ...text('Install Invoicing to draft an invoice from a returned booking.', 'muted'),
          rules: { visible: `form.values.status === 'returned' && !(form.values.invoice && form.values.invoice.path) && !(${offers('invoicing', 'create-draft-invoice')})` } },
        grid([
          { type: 'canvas.form.date', props: { label: 'Return date', description: 'Defaults to today; late fees count days past the end date.', value: '{{ state.returndate }}' }, rules: returnVisible },
        ]),
      ],
      buttons: [
        button('Copy name', 'copy-name', { visible: `${draft} && !!form.values.customerRef`, disabled: `form.saving || ${archived}` }, 'outline', 'copy'),
        button('Confirm', 'confirm', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
        button('Pick up', 'pickup', { visible: confirmed, disabled: idle }, undefined, 'package-open'),
        button('Return', 'return', { visible: pickedUp, disabled: idle }, undefined, 'package-check'),
        button('Cancel', 'cancel', { visible: `(${draft} || ${confirmed}) && !(${archived})`, disabled: idle }, 'ghost', 'x'),
        button('Reopen', 'reopen', { visible: `form.values.status === 'cancelled' && !(${archived})`, disabled: 'form.saving' }, 'outline', 'rotate-ccw'),
        // Returned but no invoice yet (Invoicing arrived later, or drafting failed): ask Invoicing again.
        button('Draft invoice', 'draft-invoice', { visible: `form.values.status === 'returned' && !(form.values.invoice && form.values.invoice.path) && ${offers('invoicing', 'create-draft-invoice')}`, disabled: idle }, 'outline', 'file-text'),
      ],
      links: [
        linkButton('Product', 'form.values.product', 'package'),
        linkButton('Invoice', 'form.values.invoice && form.values.invoice.path', 'file-text'),
        linkButton('CRM customer', 'form.values.customerRef', 'building-2'),
      ],
      actions: {
        'copy-name': { steps: [{ 'patch-form': { values: { customerName: `{{ ${copyName} }}` } } }] },
        confirm: scriptAction(postScriptPath, 'confirm-booking', { confirm: { title: 'Confirm booking', message: 'Confirm this booking? Availability is checked against overlapping bookings and the exact total is computed. Confirmed bookings cannot be edited.' } }),
        pickup: scriptAction(postScriptPath, 'pickup-booking', { confirm: { title: 'Pick up', message: 'Mark this booking picked up? The rented units leave with the customer.' } }),
        return: scriptAction(postScriptPath, 'return-booking', {
          confirm: { title: 'Return', message: 'Mark this booking returned? Days past the end date are charged at the daily late rate, and Invoicing drafts the invoice when it is installed.' },
          parameters: { date: '{{ state.returndate }}' },
        }),
        'draft-invoice': scriptAction(postScriptPath, 'return-booking', {}),
        cancel: scriptAction(postScriptPath, 'cancel-booking', { confirm: { title: 'Cancel booking', message: 'Cancel this booking? Its units become available again. It can be reopened later.' } }),
        reopen: { steps: [
          { 'patch-form': { values: { status: 'draft', updatedAt: '{{ Date() }}' } } },
          { save: {} },
          { toast: { message: 'Reopened as a draft', variant: 'success' } },
        ] },
      },
    }
  }
  return { locked: 'false', access: [], data: {}, notices: [], buttons: [], links: [], actions: {} }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const lower = entity.singular.toLowerCase()
  const displayName = lower.startsWith('rental') ? entity.singular : `Rental ${lower}`
  const header = recordHeader(
    `{{ form.values.${entity.titleKey} || 'New ${lower}' }}`,
    [
        badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...extras.buttons, recordButtons(extras.locked)],
  )
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    badge(`This ${lower} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...(extras.links.length ? [row(extras.links)] : []),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `rental-${kind}`, displayName,
      description: `View and edit a ${displayName.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: [...extras.access, schemaAccess],
      data: extras.data, state: extras.state, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'rental-settings', displayName: 'Rental settings', description: 'Edit the Rental settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        pageHeader(
          [heading('Rental settings'), text('The currency drafted invoices use and the late fee charged per unit per day past a booking\'s end date.', 'muted')], [
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

const today = "Date().slice(0, 10)"
const open = "(e.data.status === 'confirmed' || e.data.status === 'picked-up')"
// Units out of a product right now: confirmed and picked-up bookings whose dates cover today.
const outToday = product => `(data.bookings || []).filter(b => b.kind === 'file' && b.data && b.data.state !== 'archived' && (b.data.status === 'confirmed' || b.data.status === 'picked-up') && b.data.product === ${product} && (b.data.startDate || '') <= ${today} && ${today} <= (b.data.endDate || '')).reduce((s, b) => s + Number(b.data.quantity || 0), 0)`
// Availability per product: owned minus what overlapping confirmed and picked-up bookings have out today.
const availability = `(data.products || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', status: e.data.status, dailyRate: e.data.dailyRate || '', owned: Number(e.data.quantityOwned || 0), out: ${outToday('e.path')} })).map(r => ({ path: r.path, code: r.code, name: r.name, status: r.status, dailyRate: r.dailyRate, owned: r.owned, out: r.out, available: r.status === 'available' ? r.owned - r.out : 0 }))`

const billedValue = filter => `(data.bookings || []).filter(e => ${active} && (${filter}) && e.data.total).reduce((s, e) => s + ${units('e.data.total')}, 0)`
const lateFees = `(data.bookings || []).filter(e => ${active} && e.data.status === 'returned').reduce((s, e) => s + ${units('e.data.lateFee')}, 0)`
const depositsHeld = `(data.bookings || []).filter(e => ${active} && ${open}).reduce((s, e) => s + ${units('e.data.deposit')} * Number(e.data.quantity || 0), 0)`

const bookingRow = "({ path: e.path, code: e.data.code || e.name, customer: e.data.customerName || '', product: (e.data.product || '').split('/').pop() || '', start: e.data.startDate, end: e.data.endDate, quantity: e.data.quantity, status: e.data.status, total: e.data.total || '' })"
const byStart = 'sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))'

const bookingSources = { bookings: folder(containers.bookings.path, mimeTypes.booking) }

function homePage() {
  const browse = (name, kind, columns) => browser(containers[name].path, mimeTypes[kind], [{ key: 'name', label: 'Number' }, ...columns],
    `No ${entities[kind].plural.toLowerCase()} yet. Use New in ${containers[name].path}.`)
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'rental-home', name: 'Rental', description: 'Rental overview.', icon: 'key' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: Object.values(containers).map(container => ({ path: container.path, reason: `List ${container.path.slice(1).split('-').join(' ')}` })),
        data: { ...productSources, ...bookingSources },
        tree: page([
          pageHeader(
            [heading('Rental'), text('Rental products and bookings are files in your workspace. Draft bookings in their folder, then confirm, pick up and return them from their forms.', 'muted')], [
            row([
              button('Bookings', [openFile(`${installRoot}/canvas/bookings.page.yaml`)], undefined, 'outline', 'calendar-check'),
              button('Availability', [openFile(`${installRoot}/canvas/availability.page.yaml`)], undefined, 'outline', 'boxes'),
              button('Revenue', [openFile(`${installRoot}/canvas/revenue.page.yaml`)], undefined, 'outline', 'chart-no-axes-combined'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Rental products', count('products'), 'package', loading('products')),
            stat('Draft bookings', count('bookings', "e.data.status === 'draft'"), 'file-pen', loading('bookings')),
            stat('Out with customers', count('bookings', "e.data.status === 'picked-up'"), 'package-open', loading('bookings')),
            stat('Booked revenue', `{{ ${display(billedValue(`${open} || e.data.status === 'returned'`))} }}`, 'receipt', loading('bookings')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Rental to recreate it.`)[0]),
          tabs([
            { value: 'products', label: 'Rental products', icon: 'package' },
            { value: 'bookings', label: 'Bookings', icon: 'calendar-check' },
          ], [
            panel('products', [row([button('Open /rental-products', [openFile(containers.products.path)], undefined, 'outline', 'folder-open')]),
              browse('products', 'product', [{ key: 'data.name', label: 'Name' }, { key: 'data.dailyRate', label: 'Daily rate', align: 'end' }, { key: 'data.quantityOwned', label: 'Owned', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('bookings', [row([button('Open /rental-bookings', [openFile(containers.bookings.path)], undefined, 'outline', 'folder-open')]),
              browse('bookings', 'booking', [{ key: 'data.customerName', label: 'Customer' }, { key: 'data.startDate', label: 'Start' }, { key: 'data.endDate', label: 'End' }, { key: 'data.total', label: 'Total', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
          ]),
        ]),
      },
    },
  }
}

function bookingsPage() {
  const rows = `{{ (data.bookings || []).filter(e => ${active} && (state.showclosed || (e.data.status !== 'returned' && e.data.status !== 'cancelled'))).map(e => ${bookingRow}).${byStart} }}`
  return {
    file: 'bookings.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'rental-bookings', name: 'Bookings', description: 'Bookings by status, ordered by start date.', icon: 'calendar-check' },
      spec: {
        access: [{ path: containers.bookings.path, reason: 'List bookings by status' }],
        data: bookingSources,
        state: { showclosed: false },
        tree: page([
          pageHeader(
            [heading('Bookings'), text('The rental calendar as a list: bookings ordered by start date, badged by status. Confirming reserves the units; picking up and returning move them through the lifecycle.', 'muted')], [
            button('Rental', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'key'),
          ]),
          ...status('bookings'),
          stats([
            stat('Draft', count('bookings', "e.data.status === 'draft'"), 'file-pen', loading('bookings')),
            stat('Confirmed', count('bookings', "e.data.status === 'confirmed'"), 'check', loading('bookings')),
            stat('Picked up', count('bookings', "e.data.status === 'picked-up'"), 'package-open', loading('bookings')),
            stat('Returned', count('bookings', "e.data.status === 'returned'"), 'package-check', loading('bookings')),
          ]),
          { type: 'canvas.form.switch', props: { label: 'Show returned and cancelled bookings', value: '{{ state.showclosed }}' } },
          table(rows, [['code', 'Booking'], ['customer', 'Customer'], ['product', 'Product'], ['start', 'Start'], ['end', 'End'],
            ['quantity', 'Qty', 'end'], ['status', 'Status'], ['total', 'Total', 'end']], 'No bookings yet', true),
        ]),
      },
    },
  }
}

function availabilityPage() {
  const rows = `{{ (data.availability || []).map(r => ({ path: r.path, code: r.code, name: r.name, status: r.status, dailyRate: r.dailyRate, owned: r.owned, out: r.out, available: r.available })) }}`
  return {
    file: 'availability.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'rental-availability', name: 'Availability', description: 'What is owned, out and available per rental product today.', icon: 'boxes' },
      spec: {
        access: [
          { path: containers.products.path, reason: 'List rental products and the quantity owned' },
          { path: containers.bookings.path, reason: 'Subtract overlapping confirmed and picked-up bookings' },
        ],
        data: {
          products: folder(containers.products.path, mimeTypes.product),
          ...bookingSources,
          availability: { kind: 'computed', expr: availability },
        },
        tree: page([
          pageHeader(
            [heading('Availability'), text('Per product: units owned, out on confirmed and picked-up bookings covering today, and what is left to rent.', 'muted')], [
            button('Rental', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'key'),
          ]),
          ...status('products'),
          ...status('bookings'),
          stats([
            stat('Products', count('products'), 'package', loading('products')),
            stat('Units owned', '{{ (data.availability || []).reduce((s, r) => s + r.owned, 0) }}', 'boxes', loading('products')),
            stat('Units out', '{{ (data.availability || []).reduce((s, r) => s + r.out, 0) }}', 'package-open', loading('bookings')),
            stat('Units available', '{{ (data.availability || []).reduce((s, r) => s + r.available, 0) }}', 'package-check', loading('bookings')),
          ]),
          table(rows, [['code', 'Product'], ['name', 'Name'], ['status', 'Status'], ['dailyRate', 'Daily rate', 'end'],
            ['owned', 'Owned', 'end'], ['out', 'Out', 'end'], ['available', 'Available', 'end']], 'No rental products yet', true),
        ]),
      },
    },
  }
}

function revenuePage() {
  const billed = `(data.bookings || []).filter(e => ${active} && e.data.total && (${open} || e.data.status === 'returned'))`
  const rows = `{{ ${billed}.map(e => ${bookingRow}).${byStart} }}`
  return {
    file: 'revenue.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'rental-revenue', name: 'Revenue', description: 'Booked rental revenue, late fees and deposits held.', icon: 'chart-no-axes-combined' },
      spec: {
        access: [{ path: containers.bookings.path, reason: 'Sum booking totals, late fees and deposits' }],
        data: bookingSources,
        tree: page([
          pageHeader(
            [heading('Revenue'), text('Confirmed, picked-up and returned bookings use their exact script-computed totals; late fees are added on return.', 'muted')], [
            button('Rental', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'key'),
          ]),
          ...status('bookings'),
          stats([
            stat('Booked revenue', `{{ ${display(billedValue(`${open} || e.data.status === 'returned'`))} }}`, 'receipt', loading('bookings')),
            stat('Returned revenue', `{{ ${display(billedValue("e.data.status === 'returned'"))} }}`, 'package-check', loading('bookings')),
            stat('Late fees', `{{ ${display(lateFees)} }}`, 'alarm-clock', loading('bookings')),
            stat('Deposits held', `{{ ${display(depositsHeld)} }}`, 'piggy-bank', loading('bookings')),
          ]),
          card('Billed bookings', [table(rows, [['code', 'Booking'], ['customer', 'Customer'], ['product', 'Product'], ['start', 'Start'], ['end', 'End'],
            ['status', 'Status'], ['total', 'Total', 'end']], 'Nothing billed yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), bookingsPage(), availabilityPage(), revenuePage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
