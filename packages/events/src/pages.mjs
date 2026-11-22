// Generates the Events Canvas documents: a bound form per record kind, the settings form, the launch page,
// the events-by-status list and the registrations/capacity report. Publishing, completing and cancelling events
// and confirming, checking in and cancelling registrations (transitions, capacity, stamps, locking) are done by
// the action script the forms run.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import {
  confirmableStatuses, containers, countedStatuses, eventStatuses, installRoot, mimeTypes, recordKinds,
  schemaId, settingsPath,
} from './contracts.mjs'
import { entities, postScriptPath, settingsFields } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const eventTones = { success: ['published', 'done'], warning: ['ongoing'], danger: ['cancelled'] }
const registrationTones = { success: ['confirmed', 'attended'], danger: ['cancelled'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Events schemas and run the action script' }
const idle = 'form.saving || form.dirty'
const eventLocked = `${JSON.stringify(['done', 'cancelled'])}.includes(form.values.status)`
const registrationLocked = `${JSON.stringify(['attended', 'cancelled'])}.includes(form.values.status)`
const cancellable = `${JSON.stringify(['draft', 'published', 'ongoing'])}.includes(form.values.status)`
const completable = `${JSON.stringify(confirmableStatuses)}.includes(form.values.status)`

const eventSources = {
  events: folder(containers.events.path, mimeTypes.event),
  eventoptions: { kind: 'computed', expr: options('events', "e.data.name || ''") },
}
const eventsAccess = reason => ({ path: containers.events.path, reason })
const registrationsAccess = reason => ({ path: containers.registrations.path, reason })

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const counted = `${JSON.stringify(countedStatuses)}.includes(r.data.status)`
/** Seats confirmed or attended against one event, summed over the active registrations. */
const takenFor = eventPath => `(data.registrations || []).filter(r => ${active.replaceAll('e.', 'r.')} && ${counted} && r.data.event === ${eventPath}).reduce((total, r) => total + (Number(r.data.qty) || 0), 0)`

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'event') {
    return {
      access: [registrationsAccess('Show confirmed seats against this event\'s capacity'), schemaAccess],
      data: { registrations: folder(containers.registrations.path, mimeTypes.registration) },
      notices: [
        { ...text(`Seats taken: {{ ${takenFor('ctx.file.path')} }} of {{ form.values.capacity }}.`, 'muted'),
          rules: { visible: `${JSON.stringify(confirmableStatuses)}.includes(form.values.status)` } },
        { ...text('This event is done and can no longer be edited.', 'muted'), rules: { visible: "form.values.status === 'done'" } },
        { ...text('This event is cancelled and can no longer be edited.', 'muted'), rules: { visible: "form.values.status === 'cancelled'" } },
      ],
      buttons: [
        button('Publish', 'publish', { visible: `form.values.status === 'draft' && !(${archived})`,
          disabled: `${idle} || !form.values.startsAt` }, undefined, 'megaphone'),
        button('Complete', 'complete', { visible: `${completable} && !(${archived})`, disabled: idle }, 'outline', 'check'),
        button('Cancel event', 'cancel', { visible: `${cancellable} && !(${archived})`, disabled: idle }, 'ghost', 'x'),
      ],
      actions: {
        publish: scriptAction(postScriptPath, 'publish', {
          confirm: { title: 'Publish event', message: 'Publish this event? Published events accept confirmed registrations.' },
        }),
        complete: scriptAction(postScriptPath, 'complete', {
          confirm: { title: 'Complete event', message: 'Mark this event done? Done events are locked and accept no more confirmations.' },
        }),
        cancel: scriptAction(postScriptPath, 'cancel', {
          confirm: { title: 'Cancel event', message: 'Cancel this event? Cancelled events are locked and accept no more confirmations.' },
        }),
      },
      locked: eventLocked,
    }
  }
  return {
    access: [
      eventsAccess('Choose the event a registration belongs to'),
      registrationsAccess('Show how many seats are already taken on the chosen event'),
      schemaAccess,
    ],
    data: {
      ...eventSources,
      registrations: folder(containers.registrations.path, mimeTypes.registration),
    },
    notices: [
      { ...text(`Seats taken on this event: {{ ${takenFor('form.values.event')} }}.`, 'muted'),
        rules: { visible: '!!form.values.event' } },
      { ...text('This registration is cancelled and can no longer be edited.', 'muted'), rules: { visible: "form.values.status === 'cancelled'" } },
      { ...text('This attendee has checked in; the registration is locked.', 'muted'), rules: { visible: "form.values.status === 'attended'" } },
    ],
    buttons: [
      button('Confirm', 'confirm', { visible: `form.values.status === 'draft' && !(${archived})`,
        disabled: `${idle} || !form.values.event` }, undefined, 'check'),
      button('Check in', 'check-in', { visible: `form.values.status === 'confirmed' && !(${archived})`, disabled: idle }, 'outline', 'user-check'),
      button('Cancel registration', 'cancel-registration', {
        visible: `${JSON.stringify(['draft', 'confirmed'])}.includes(form.values.status) && !(${archived})`, disabled: idle }, 'ghost', 'x'),
    ],
    actions: {
      confirm: scriptAction(postScriptPath, 'confirm', {
        confirm: { title: 'Confirm registration', message: 'Confirm this registration? The event must be published or ongoing and have enough remaining capacity.' },
      }),
      'check-in': scriptAction(postScriptPath, 'check-in', {
        confirm: { title: 'Check in', message: 'Mark this attendee as attended? Attended registrations are locked.' },
      }),
      'cancel-registration': scriptAction(postScriptPath, 'cancel-registration', {
        confirm: { title: 'Cancel registration', message: 'Cancel this registration? Its seats are released and the record is locked.' },
      }),
    },
    locked: registrationLocked,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const tones = kind === 'event' ? eventTones : registrationTones
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        badge(humanize(entity.status), toneExpression(entity.status, tones), { visible: `!!form.values.${entity.status}` }),
        badge('Archived', 'warning', { visible: archived }, 'archive'),
      ]),
      text(`${entity.singular} {{ form.values.code || '' }} · {{ ctx.file.path }}`, 'muted'),
    ]),
    row([...extras.buttons, recordButtons(extras.locked)]),
  ], 'between')
  const tree = [
    header,
    ...status('record'),
    badge(`This ${entity.singular.toLowerCase()} is archived. Restore it to edit.`, 'warning', { visible: archived }, 'archive'),
    ...extras.notices,
    grid(sectionCards(entity.sections, readOnly)),
  ]
  return {
    file: `${kind}.form.yaml`,
    document: boundForm({
      name: `events-${kind}`, displayName: `Events ${entity.singular.toLowerCase()}`,
      description: `View and edit an Events ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
      mime: mimeTypes[kind], schemaId: schemaId(kind), schemaSource: `${installRoot}/schemas/${kind}.schema.json`,
      access: extras.access, data: extras.data, tree,
      actions: { ...baseActions, ...extras.actions },
    }),
  }
}

function settingsForm() {
  return {
    file: 'settings.form.yaml',
    document: boundForm({
      name: 'events-settings', displayName: 'Events settings', description: 'Edit the Events settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [schemaAccess],
      data: {},
      tree: [
        row([
          column([heading('Events settings'), text('The default venue for new events. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        grid([card('Defaults', [grid(settingsFields.map(field => formControl(field, null)))])], 1),
      ],
      actions: {},
    }),
  }
}

const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active event flattened for the pages: status, schedule, capacity and the seats taken against it.
const eventRows = `(data.events || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', venue: e.data.venue || '', startsAt: e.data.startsAt || '', status: e.data.status || '', capacity: Number(e.data.capacity) || 0, taken: ${takenFor('e.path')}, remaining: Math.max((Number(e.data.capacity) || 0) - (${takenFor('e.path')}), 0) }))`
// Every active registration flattened for the pages, with its event's name looked up.
const registrationRows = `(data.registrations || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, attendee: e.data.attendeeName || '', event: ((((data.events || []).find(v => v.kind === 'file' && v.data && v.path === e.data.event) || {}).data || {}).name) || '', eventPath: e.data.event || '', qty: Number(e.data.qty) || 0, status: e.data.status || '' }))`

const pageSources = {
  events: folder(containers.events.path, mimeTypes.event),
  registrations: folder(containers.registrations.path, mimeTypes.registration),
  rows: { kind: 'computed', expr: eventRows },
  registrationrows: { kind: 'computed', expr: registrationRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const eventColumns = [['code', 'Event'], ['name', 'Name'], ['venue', 'Venue'], ['startsAt', 'Starts at'],
  ['taken', 'Seats taken', 'end'], ['capacity', 'Capacity', 'end'], ['remaining', 'Remaining', 'end']]

const containerNotices = () => Object.keys(containers).map(name =>
  status(name, `The ${containers[name].path} folder could not be read. Reinstall Events to recreate it.`)[0])

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'events-home', name: 'Events', description: 'Events overview.', icon: 'calendar' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count events and registrations and show them'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Events'), text('Events and registrations are files in your workspace. Draft events in /events, publish them, then confirm and check in registrations from their forms.', 'muted')]),
            row([
              button('All events', [openFile(`${installRoot}/canvas/events.page.yaml`)], undefined, 'outline', 'calendar'),
              button('Registrations', [openFile(`${installRoot}/canvas/registrations.page.yaml`)], undefined, 'outline', 'user-check'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Published', countOf("r.status === 'published'"), 'megaphone', loading('events')),
            stat('Ongoing', countOf("r.status === 'ongoing'"), 'play', loading('events')),
            stat('Draft', countOf("r.status === 'draft'"), 'pencil', loading('events')),
            stat('Seats confirmed', `{{ (data.rows || []).reduce((total, r) => total + r.taken, 0) }}`, 'user-check', loading('registrations')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'events', label: 'Events', icon: 'calendar' },
            { value: 'registrations', label: 'Registrations', icon: 'user-check' },
          ], [
            panel('events', [row([button('Open /events', [openFile(containers.events.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.events.path, mimeTypes.event, [{ key: 'name', label: 'Event' }, { key: 'data.name', label: 'Name' },
                { key: 'data.status', label: 'Status' }, { key: 'data.startsAt', label: 'Starts at' },
                { key: 'data.capacity', label: 'Capacity' }], `No events yet. Use New in ${containers.events.path}.`)]),
            panel('registrations', [row([button('Open /event-registrations', [openFile(containers.registrations.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.registrations.path, mimeTypes.registration, [{ key: 'name', label: 'Registration' }, { key: 'data.attendeeName', label: 'Attendee' },
                { key: 'data.qty', label: 'Seats' }, { key: 'data.status', label: 'Status' }], `No registrations yet. Use New in ${containers.registrations.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function eventsPage() {
  const statusTable = value => table(`{{ (data.rows || []).filter(r => r.status === '${value}') }}`,
    eventColumns, `No ${statusLabel(value).toLowerCase()} events`, true)
  return {
    file: 'events.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'events-events', name: 'All events', description: 'Every event, listed by status.', icon: 'calendar' },
      spec: {
        access: pageAccess('List events by status with their seats taken'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Events by status'), text('Every active event, grouped by its status. Click a row to open the event.', 'muted')]),
            button('Events', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar'),
          ], 'between'),
          ...containerNotices(),
          stats(eventStatuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'calendar', loading('events'))), 5),
          tabs(eventStatuses.map(value => ({ value, label: statusLabel(value), icon: 'calendar' })),
            eventStatuses.map(value => panel(value, [statusTable(value)]))),
        ]),
      },
    },
  }
}

function registrationsPage() {
  const summaryRows = `{{ ${eventRows}.map(r => ({ path: r.path, code: r.code, name: r.name, status: r.status, capacity: r.capacity, taken: r.taken, remaining: r.remaining, fill: r.capacity > 0 ? Math.round(r.taken * 100 / r.capacity) + '%' : '' })) }}`
  const registrationTable = `{{ (data.registrationrows || []).map(r => ({ path: r.path, code: r.code, attendee: r.attendee, event: r.event, qty: r.qty, status: r.status })) }}`
  return {
    file: 'registrations.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'events-registrations', name: 'Registrations', description: 'Registrations per event, against capacity.', icon: 'user-check' },
      spec: {
        access: pageAccess('Sum confirmed and attended seats per event against its capacity'),
        data: pageSources,
        tree: page([
          row([
            column([heading('Registrations'), text('Confirmed and attended seats per event, against its capacity. Click a row to open the record.', 'muted')]),
            button('Events', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Registrations', '{{ (data.registrationrows || []).length }}', 'user-check', loading('registrations')),
            stat('Seats confirmed', `{{ (data.registrationrows || []).filter(r => ${JSON.stringify(countedStatuses)}.includes(r.status)).reduce((total, r) => total + r.qty, 0) }}`, 'check', loading('registrations')),
            stat('Attended', `{{ (data.registrationrows || []).filter(r => r.status === 'attended').reduce((total, r) => total + r.qty, 0) }}`, 'badge-check', loading('registrations')),
            stat('Cancelled', `{{ (data.registrationrows || []).filter(r => r.status === 'cancelled').length }}`, 'x', loading('registrations')),
          ]),
          card('Capacity per event', [table(summaryRows, [['code', 'Event'], ['name', 'Name'], ['status', 'Status'],
            ['taken', 'Seats taken', 'end'], ['capacity', 'Capacity', 'end'], ['remaining', 'Remaining', 'end'], ['fill', 'Fill', 'end']],
            'No events yet', true)]),
          card('Registrations', [table(registrationTable, [['code', 'Registration'], ['attendee', 'Attendee'], ['event', 'Event'],
            ['qty', 'Seats', 'end'], ['status', 'Status']], 'No registrations yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), eventsPage(), registrationsPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
