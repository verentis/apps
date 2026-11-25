// Generates the Fleet Canvas documents: one bound form per record kind, the settings form, the launch page,
// the contracts page with the expiring-soon report and the cost summary per vehicle. Fleet rules (existing
// vehicles, monotonic odometer readings, the active-to-retired transition) are enforced by the posting script
// the forms run; the forms only lock what the script has done.
import { views } from './views.mjs'
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  iconName, jsonFile, options, page, panel, projectRegistration, recordButtons, row, scriptAction, sectionCards,
  stat, stats, status, table, tabs, text, toneExpression, humanize, recordHeader, archivedAlert, pageHeader, appNavigation, lifecycle,
} from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath } from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = {
  success: ['active', 'done'],
  warning: ['in-maintenance', 'draft', 'expired'],
}
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Fleet schemas and run the posting script' }
const vehiclesAccess = reason => ({ path: containers.vehicles.path, reason })
const contractsAccess = reason => ({ path: containers.contracts.path, reason })
const servicesAccess = reason => ({ path: containers.services.path, reason })
const vehicleLabel = "((e.data.make || '') + ' ' + (e.data.model || '')).trim()"
const pickSources = {
  vehicles: folder(containers.vehicles.path, mimeTypes.vehicle),
  vehicleoptions: { kind: 'computed', expr: options('vehicles', vehicleLabel, "e.data.status !== 'retired'") },
}

// Report arithmetic runs in the Canvas expression language, which has only floating point numbers, so amounts
// are summed as integer ten-thousandths (exact for every amount a file can hold) and only divided for display.
const units = amount => `Math.round(Number(${amount} || 0) * 10000)`
const display = value => `(${value} / 10000)`

const idle = 'form.saving || form.dirty'

/** Kind-specific data, access, actions, header buttons and tabs of a record form. */
function recordExtras(kind) {
  if (kind === 'vehicle') {
    const history = `(data.services || []).filter(s => s.kind === 'file' && s.data && s.data.kind === 'service' && s.data.vehicle === ctx.file.path).map(s => ({ path: s.path, date: s.data.date || '', log: s.data.code || s.name, type: s.data.type || '', description: s.data.description || '', odometerKm: s.data.odometerKm || '', cost: s.data.cost || '', status: s.data.status || '' })).sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))`
    const active = "form.values.status === 'active'"
    return {
      locked: "(form.values.status === 'retired')",
      access: [servicesAccess('Show the service history of this vehicle')],
      data: { services: folder(containers.services.path, mimeTypes.service) },
      buttons: [
        button('Retire', 'retire', { visible: `${active} && !(${archived})`, disabled: idle }, undefined, 'circle-off'),
      ],
      actions: {
        retire: scriptAction(postScriptPath, 'retire', { confirm: { title: 'Retire vehicle', message: 'Retire this vehicle? Retired vehicles are locked, keep their history and cannot be reactivated from the form.' } }),
      },
      tabs: [{ value: 'services', label: 'Service history', icon: 'wrench' }],
      panels: [panel('services', [
        ...status('services'),
        table(`{{ ${history} }}`, [['date', 'Date'], ['log', 'Log'], ['type', 'Type'], ['description', 'Description'], ['odometerKm', 'Odometer (km)', 'end'], ['cost', 'Cost', 'end'], ['status', 'Status']],
          'No service logs for this vehicle yet', true),
      ])],
    }
  }
  if (kind === 'contract') {
    return {
      access: [vehiclesAccess('Choose the vehicle under contract')],
      data: pickSources,
    }
  }
  const draft = "(!form.values.status || form.values.status === 'draft')"
  return {
    locked: `!${draft}`,
    access: [vehiclesAccess('Choose the vehicle that was serviced')],
    data: pickSources,
    buttons: [
      button('Log service', 'log', { visible: `${draft} && !(${archived})`, disabled: `${idle} || form.invalid` }, undefined, 'check'),
    ],
    actions: {
      log: scriptAction(postScriptPath, 'log-service', { confirm: { title: 'Log service', message: 'Mark this service done? The vehicle\u2019s odometer is updated to the reading, and done service logs cannot be edited.' } }),
    },
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const locked = extras.locked ?? 'false'
  const readOnly = `${archived} || (${locked})`
  const header = recordHeader(
    entity.title,
    [
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
    ],
    `${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`,
    [...(extras.buttons ?? []), recordButtons(locked)],
  )
  const overview = [grid(sectionCards(entity.sections, readOnly))]
  const tree = [
    header,
    ...status('record'), ...lifecycle(entity),
    archivedAlert(entity.singular),
    ...(extras.tabs
      ? [tabs([{ value: 'overview', label: 'Overview', icon: iconName(entity.icon) }, ...extras.tabs], [panel('overview', overview), ...extras.panels])]
      : overview),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `fleet-${kind}`, displayName: `Fleet ${entity.singular.toLowerCase()}`,
      description: `View and edit a Fleet ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'fleet-settings', displayName: 'Fleet settings', description: 'Edit the Fleet settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      tree: [
        pageHeader(
          [heading('Fleet settings'), text('How soon an ending contract counts as expiring. Code prefixes are app settings, managed with the installed app.', 'muted')], [
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ]),
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
      metadata: { id: 'fleet-home', name: 'Fleet', description: 'Fleet overview.', icon: 'car' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: [
          vehiclesAccess('List the vehicles'),
          contractsAccess('List the fleet contracts'),
          servicesAccess('List the service logs'),
        ],
        data: {
          vehicles: folder(containers.vehicles.path, mimeTypes.vehicle),
          contracts: folder(containers.contracts.path, mimeTypes.contract),
          services: folder(containers.services.path, mimeTypes.service),
        },
        tree: page([
          pageHeader(
            [heading('Fleet'), text('Vehicles, fleet contracts and service logs as files in your workspace. Draft service logs in their folder, then log them from their forms; retire vehicles from theirs.', 'muted')], [
            row([
              button('Contracts', [{ 'open-file': { path: `${installRoot}/canvas/contracts.page.yaml` } }], undefined, 'outline', 'file-signature'),
              button('Costs', [{ 'open-file': { path: `${installRoot}/canvas/costs.page.yaml` } }], undefined, 'outline', 'chart-column'),
              button('Settings', [{ 'open-file': { path: settingsPath, mode: 'edit' } }], undefined, 'ghost', 'settings'),
            ]),
          ]),
          stats([
            stat('Vehicles in service', count('vehicles', "e.data.status !== 'retired'"), 'car', loading('vehicles')),
            stat('In maintenance', count('vehicles', "e.data.status === 'in-maintenance'"), 'wrench', loading('vehicles')),
            stat('Active contracts', count('contracts', "e.data.status === 'active'"), 'file-signature', loading('contracts')),
            stat('Draft service logs', count('services', "e.data.status === 'draft'"), 'clipboard-list', loading('services')),
          ]),
          ...Object.keys(containers).map(name =>
            status(name, `The ${containers[name].path} folder could not be read. Reinstall Fleet to recreate it.`)[0]),
          tabs([
            { value: 'vehicles', label: 'Vehicles', icon: 'car' },
            { value: 'contracts', label: 'Contracts', icon: 'file-signature' },
            { value: 'services', label: 'Service logs', icon: 'wrench' },
          ], [
            panel('vehicles', [row([button('Open /vehicles', [{ 'open-file': { path: containers.vehicles.path } }], undefined, 'outline', 'folder-open')]),
              browse('vehicles', 'vehicle', [{ key: 'data.make', label: 'Make' }, { key: 'data.model', label: 'Model' }, { key: 'data.licensePlate', label: 'Plate' }, { key: 'data.driverName', label: 'Driver' }, { key: 'data.odometerKm', label: 'Odometer (km)', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('contracts', [row([button('Open /fleet-contracts', [{ 'open-file': { path: containers.contracts.path } }], undefined, 'outline', 'folder-open')]),
              browse('contracts', 'contract', [{ key: 'data.vendor', label: 'Vendor' }, { key: 'data.type', label: 'Type' }, { key: 'data.endDate', label: 'Ends' }, { key: 'data.monthlyCost', label: 'Monthly cost', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
            panel('services', [row([button('Open /service-logs', [{ 'open-file': { path: containers.services.path } }], undefined, 'outline', 'folder-open')]),
              browse('services', 'service', [{ key: 'data.date', label: 'Date' }, { key: 'data.type', label: 'Type' }, { key: 'data.odometerKm', label: 'Odometer (km)', align: 'end' }, { key: 'data.cost', label: 'Cost', align: 'end' }, { key: 'data.status', label: 'Status' }])]),
          ]),
        ]),
      },
    },
  }
}

function contractsPage() {
  // Every non-archived contract, soonest end date first, with its monthly cost in integer ten-thousandths.
  const rowsExpr = `(data.contracts || []).filter(e => e.kind === 'file' && e.data && e.data.kind === 'contract' && e.data.state !== 'archived').map(e => ({ path: e.path, code: e.data.code || e.name, vehicle: (e.data.vehicle || '').split('/').pop(), type: e.data.type || '', vendor: e.data.vendor || '', startDate: e.data.startDate || '', endDate: e.data.endDate || '', monthlyCost: e.data.monthlyCost || '', monthlyUnits: ${units('e.data.monthlyCost')}, status: e.data.status || '' })).sort((a, b) => ((a.endDate || '9999-99-99') < (b.endDate || '9999-99-99') ? -1 : 1))`
  // Active contracts ending within the configured window (default 60 days), including those already past due.
  const cutoff = `Date(Date.now() + (((data.settings || {}).expiringSoonDays || 60) * 86400000)).slice(0, 10)`
  const expiringExpr = `(data.rows || []).filter(c => c.status === 'active' && c.endDate && c.endDate <= ${cutoff})`
  const columns = [['code', 'Contract'], ['vehicle', 'Vehicle'], ['type', 'Type'], ['vendor', 'Vendor'], ['startDate', 'Starts'], ['endDate', 'Ends'], ['monthlyCost', 'Monthly cost', 'end'], ['status', 'Status']]
  const activeMonthly = `(data.rows || []).reduce((sum, c) => sum + (c.status === 'active' ? c.monthlyUnits : 0), 0)`
  return {
    file: 'contracts.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'fleet-contracts', name: 'Contracts', description: 'Fleet contracts with the ones expiring soon.', icon: 'file-signature' },
      spec: {
        access: [
          contractsAccess('List the fleet contracts and their end dates'),
          { path: settingsPath, reason: 'Read how soon an ending contract counts as expiring' },
        ],
        data: {
          contracts: folder(containers.contracts.path, mimeTypes.contract),
          settings: jsonFile(settingsPath),
          rows: { kind: 'computed', expr: rowsExpr },
          expiring: { kind: 'computed', expr: expiringExpr },
        },
        tree: page([
          pageHeader(
            [heading('Contracts'), text('Lease, insurance and service contracts per vehicle. Active contracts ending within the expiring-soon window are flagged below.', 'muted')], [
            button('Fleet', [{ 'open-file': { path: `${installRoot}/canvas/home.page.yaml` } }], undefined, 'ghost', 'car'),
          ]),
          ...status('contracts'),
          stats([
            stat('Active contracts', '{{ (data.rows || []).filter(c => c.status === \'active\').length }}', 'file-signature', loading('contracts')),
            stat('Expiring soon', '{{ (data.expiring || []).length }}', 'hourglass', loading('contracts')),
            stat('Active monthly cost', `{{ ${display(activeMonthly)}.toFixed(2) }}`, 'wallet', loading('contracts')),
          ], 3),
          card('Expiring soon', [
            table('{{ data.expiring || [] }}', columns, 'No active contract ends within the window', true),
          ], 'Active contracts whose end date falls within the configured window, soonest first.'),
          card('All contracts', [
            table('{{ data.rows || [] }}', columns, 'No contracts yet. Use New in /fleet-contracts.', true),
          ]),
        ]),
      },
    },
  }
}

function costsPage() {
  // Per vehicle: the monthly cost of its active contracts plus the total cost of its done service logs.
  const costsExpr = `(data.vehicles || []).filter(v => v.kind === 'file' && v.data && v.data.kind === 'vehicle' && v.data.state !== 'archived').map(v => ({ path: v.path, code: v.data.code || v.name, vehicle: ((v.data.make || '') + ' ' + (v.data.model || '')).trim(), licensePlate: v.data.licensePlate || '', status: v.data.status || '', monthlyUnits: (data.contracts || []).filter(c => c.kind === 'file' && c.data && c.data.kind === 'contract' && c.data.state !== 'archived' && c.data.status === 'active' && c.data.vehicle === v.path).reduce((sum, c) => sum + ${units('c.data.monthlyCost')}, 0), serviceUnits: (data.services || []).filter(s => s.kind === 'file' && s.data && s.data.kind === 'service' && s.data.state !== 'archived' && s.data.status === 'done' && s.data.vehicle === v.path).reduce((sum, s) => sum + ${units('s.data.cost')}, 0) })).sort((a, b) => (a.code < b.code ? -1 : 1))`
  const rows = `{{ (data.costs || []).map(t => ({ path: t.path, code: t.code, vehicle: t.vehicle, licensePlate: t.licensePlate, status: t.status, monthly: ${display('t.monthlyUnits')}.toFixed(2), service: ${display('t.serviceUnits')}.toFixed(2) })) }}`
  const total = source => `(data.costs || []).reduce((sum, t) => sum + t.${source}, 0)`
  return {
    file: 'costs.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'fleet-costs', name: 'Costs', description: 'Cost summary per vehicle: active contracts\u2019 monthly cost plus done service costs.', icon: 'chart-column' },
      spec: {
        access: [
          vehiclesAccess('Report costs per vehicle'),
          contractsAccess('Sum the active contracts\u2019 monthly cost'),
          servicesAccess('Sum the done service logs\u2019 cost'),
        ],
        data: {
          vehicles: folder(containers.vehicles.path, mimeTypes.vehicle),
          contracts: folder(containers.contracts.path, mimeTypes.contract),
          services: folder(containers.services.path, mimeTypes.service),
          costs: { kind: 'computed', expr: costsExpr },
        },
        tree: page([
          pageHeader(
            [heading('Costs'), text('Per vehicle: the monthly cost of its active contracts and the total cost of its done service logs. Draft service logs and inactive contracts are ignored.', 'muted')], [
            button('Fleet', [{ 'open-file': { path: `${installRoot}/canvas/home.page.yaml` } }], undefined, 'ghost', 'car'),
          ]),
          ...status('vehicles'), ...status('contracts'), ...status('services'),
          stats([
            stat('Vehicles', '{{ (data.costs || []).length }}', 'car', loading('vehicles')),
            stat('Fleet monthly cost', `{{ ${display(total('monthlyUnits'))}.toFixed(2) }}`, 'wallet', loading('contracts')),
            stat('Service spend (done)', `{{ ${display(total('serviceUnits'))}.toFixed(2) }}`, 'wrench', loading('services')),
          ], 3),
          table(rows, [['code', 'Code'], ['vehicle', 'Vehicle'], ['licensePlate', 'Plate'], ['status', 'Status'], ['monthly', 'Contracts / month', 'end'], ['service', 'Service (done)', 'end']],
            'No vehicles yet', true),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), contractsPage(), costsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return appNavigation(Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)])), installRoot, views)
}
