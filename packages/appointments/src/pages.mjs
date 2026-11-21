// Generates the Appointments Canvas documents: bound forms for appointment types and appointments, the settings
// form, the launch page, the upcoming list and the per-type summary. Confirming (schedule completion and the
// host conflict check), completing, cancelling and marking no-shows are done by the action script the
// appointment form runs.
import {
  archived, badge, baseActions, boundForm, browser, button, card, column, folder, formControl, grid, heading,
  humanize, iconName, options, openFile, page, panel, projectRegistration, recordButtons, row, scriptAction,
  sectionCards, stat, stats, status, table, tabs, text, toneExpression,
} from '../../../tools/file-apps/canvas.mjs'
import { activeStatuses, containers, installRoot, mimeTypes, recordKinds, schemaId, settingsPath, statuses } from './contracts.mjs'
import { entities, postScriptPath, settingsSections } from './app.mjs'

export { collectSteps, documentFileAccess, projectRegistration } from '../../../tools/file-apps/canvas.mjs'

const statusTones = { success: ['confirmed', 'done'], warning: ['cancelled', 'no-show'] }
const schemaAccess = { path: `${installRoot}/`, reason: 'Read the Appointments schemas and run the appointment action script' }
const locked = "['done', 'cancelled', 'no-show'].includes(form.values.status)"
const idle = 'form.saving || form.dirty'
const open = activeStatuses.map(value => `form.values.status === '${value}'`).join(' || ')

const typeSources = {
  types: folder(containers.types.path, mimeTypes.type),
  typeoptions: { kind: 'computed', expr: options('types', "e.data.name || ''") },
}
const typesAccess = reason => ({ path: containers.types.path, reason })

/** Kind-specific data, access, actions, header buttons and notices of a record form. */
function recordExtras(kind) {
  if (kind === 'type') {
    return { access: [schemaAccess], data: {}, notices: [], buttons: [], actions: {}, locked: 'false' }
  }
  return {
    access: [
      typesAccess('Choose the appointment type that sets the duration, buffer and host'),
      schemaAccess,
    ],
    data: typeSources,
    notices: [
      { ...text('This appointment is finished and can no longer be edited.', 'muted'), rules: { visible: locked } },
    ],
    buttons: [
      button('Confirm', 'confirm', { visible: `form.values.status === 'booked' && !(${archived})`,
        disabled: `${idle} || !form.values.date || !form.values.startTime` }, undefined, 'check'),
      button('Complete', 'complete', { visible: `form.values.status === 'confirmed' && !(${archived})`, disabled: idle }, undefined, 'check-check'),
      button('Cancel', 'cancel', { visible: `(${open}) && !(${archived})`, disabled: idle }, 'outline', 'x'),
      button('No-show', 'mark-no-show', { visible: `(${open}) && !(${archived})`, disabled: idle }, 'ghost', 'user-x'),
    ],
    actions: {
      confirm: scriptAction(postScriptPath, 'confirm', {
        confirm: { title: 'Confirm appointment', message: 'Confirm this appointment? The end time and host are completed from the type, and the host\'s calendar is checked for conflicting appointments.' },
      }),
      complete: scriptAction(postScriptPath, 'complete', {
        confirm: { title: 'Complete appointment', message: 'Mark this appointment as done? Done appointments are locked and cannot be edited.' },
      }),
      cancel: scriptAction(postScriptPath, 'cancel', {
        confirm: { title: 'Cancel appointment', message: 'Cancel this appointment? Cancelled appointments are locked and cannot be edited.' },
      }),
      'mark-no-show': scriptAction(postScriptPath, 'mark-no-show', {
        confirm: { title: 'Mark as no-show', message: 'Mark this appointment as a no-show? No-show appointments are locked and cannot be edited.' },
      }),
    },
    locked,
  }
}

function recordForm(kind) {
  const entity = entities[kind]
  const extras = recordExtras(kind)
  const readOnly = `${archived} || (${extras.locked})`
  const header = row([
    column([
      row([
        heading(`{{ form.values.${entity.titleKey} || 'New ${entity.singular.toLowerCase()}' }}`),
        ...(entity.status ? [badge(humanize(entity.status), toneExpression(entity.status, statusTones), { visible: `!!form.values.${entity.status}` })] : []),
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
      name: `appointments-${kind}`, displayName: `Appointments ${entity.singular.toLowerCase()}`,
      description: `View and edit an Appointments ${entity.singular.toLowerCase()}.`, icon: iconName(entity.icon),
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
      name: 'appointments-settings', displayName: 'Appointments settings', description: 'Edit the Appointments settings file.', icon: 'settings',
      mime: mimeTypes.settings, schemaId: schemaId('settings'), schemaSource: `${installRoot}/schemas/settings.schema.json`,
      access: [typesAccess('Choose the default type for new appointments'), schemaAccess],
      data: typeSources,
      tree: [
        row([
          column([heading('Appointments settings'), text('The default type for new appointments. Code prefixes are app settings, managed with the installed app.', 'muted')]),
          row([
            button('Reset', [{ 'reset-form': {} }], { disabled: 'form.saving || !form.dirty' }, 'ghost'),
            button('Save', [{ save: {} }, { toast: { message: 'Saved', variant: 'success' } }], { disabled: 'form.saving || !form.dirty || form.invalid' }, undefined, 'save'),
          ]),
        ], 'between'),
        ...status('record'),
        ...status('types', `The ${containers.types.path} folder could not be read. Reinstall Appointments to recreate it.`),
        grid(settingsSections.map(section => card(section.title, [grid(section.fields.map(field => formControl(field, null)))], section.description)), 1),
      ],
      actions: {},
    }),
  }
}

const active = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const loading = source => `{{ data.$${source}.status === 'loading' }}`

// Every active appointment flattened for the pages: guest, type name, host, date, times and status.
const appointmentRows = `(data.appointments || []).filter(e => ${active}).map(e => ({ path: e.path, code: e.data.code || e.name, guest: e.data.guestName || '', typePath: e.data.type || '', type: ((((data.types || []).find(t => t.kind === 'file' && t.data && t.path === e.data.type) || {}).data || {}).name) || '', host: e.data.host || '', date: e.data.date || '', start: e.data.startTime || '', time: [e.data.startTime, e.data.endTime].filter(Boolean).join('–'), status: e.data.status || '' }))`
const appointmentSources = {
  appointments: folder(containers.appointments.path, mimeTypes.appointment),
  types: folder(containers.types.path, mimeTypes.type),
  rows: { kind: 'computed', expr: appointmentRows },
}
const pageAccess = reason => Object.values(containers).map(container => ({ path: container.path, reason }))
const countOf = filter => `{{ (data.rows || []).filter(r => ${filter}).length }}`
const statusLabel = value => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const appointmentColumns = [['code', 'Appointment'], ['guest', 'Guest'], ['type', 'Type'], ['host', 'Host'], ['date', 'Date'], ['time', 'Time'], ['status', 'Status']]
const upcoming = `(data.rows || []).filter(r => ['booked', 'confirmed'].includes(r.status) && !!r.date && r.date >= Date().slice(0, 10))`

const containerNotices = () => [
  status('appointments', `The ${containers.appointments.path} folder could not be read. Reinstall Appointments to recreate it.`)[0],
  status('types', `The ${containers.types.path} folder could not be read. Reinstall Appointments to recreate it.`)[0],
]

function homePage() {
  return {
    file: 'home.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appointments-home', name: 'Appointments', description: 'Appointments overview.', icon: 'calendar-check' },
      spec: {
        // The launch page is unbound, so it can only read the folders it declares.
        access: pageAccess('Count appointments and show the types and appointments'),
        data: appointmentSources,
        tree: page([
          row([
            column([heading('Appointments'), text('Appointment types and bookings are files in your workspace. Book appointments in /appointments, confirm them conflict-checked, then complete them from their forms.', 'muted')]),
            row([
              button('Upcoming', [openFile(`${installRoot}/canvas/upcoming.page.yaml`)], undefined, 'outline', 'calendar-check'),
              button('Types', [openFile(`${installRoot}/canvas/types.page.yaml`)], undefined, 'outline', 'calendar-clock'),
              button('Settings', [openFile(settingsPath, 'edit')], undefined, 'ghost', 'settings'),
            ]),
          ], 'between'),
          stats([
            stat('Appointments', countOf('true'), 'calendar-check', loading('appointments')),
            stat('Upcoming', `{{ ${upcoming}.length }}`, 'calendar-days', loading('appointments')),
            stat('Done', countOf("r.status === 'done'"), 'check-check', loading('appointments')),
            stat('Cancelled or no-show', countOf("['cancelled', 'no-show'].includes(r.status)"), 'x', loading('appointments')),
          ]),
          ...containerNotices(),
          tabs([
            { value: 'appointments', label: 'Appointments', icon: 'calendar-check' },
            { value: 'types', label: 'Types', icon: 'calendar-clock' },
          ], [
            panel('appointments', [row([button('Open /appointments', [openFile(containers.appointments.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.appointments.path, mimeTypes.appointment, [{ key: 'name', label: 'Appointment' }, { key: 'data.guestName', label: 'Guest' },
                { key: 'data.date', label: 'Date' }, { key: 'data.startTime', label: 'Start' }, { key: 'data.host', label: 'Host' },
                { key: 'data.status', label: 'Status' }], `No appointments yet. Use New in ${containers.appointments.path}.`)]),
            panel('types', [row([button('Open /appointment-types', [openFile(containers.types.path)], undefined, 'outline', 'folder-open')]),
              browser(containers.types.path, mimeTypes.type, [{ key: 'name', label: 'Type' }, { key: 'data.name', label: 'Name' },
                { key: 'data.durationMinutes', label: 'Minutes' }, { key: 'data.host', label: 'Host' }], `No types yet. Use New in ${containers.types.path}.`)]),
          ]),
        ]),
      },
    },
  }
}

function upcomingPage() {
  const upcomingRows = `{{ ${upcoming}.sort((a, b) => ((a.date + (a.start || '~')) < (b.date + (b.start || '~')) ? -1 : 1)) }}`
  const todayRows = `{{ ${upcoming}.filter(r => r.date === Date().slice(0, 10)).sort((a, b) => ((a.start || '~') < (b.start || '~') ? -1 : 1)) }}`
  return {
    file: 'upcoming.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appointments-upcoming', name: 'Upcoming', description: 'Booked and confirmed appointments from today on.', icon: 'calendar-days' },
      spec: {
        access: pageAccess('List the upcoming booked and confirmed appointments'),
        data: appointmentSources,
        tree: page([
          row([
            column([heading('Upcoming appointments'), text('Booked and confirmed appointments from today on, in schedule order. Click an appointment to open it.', 'muted')]),
            button('Appointments', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-check'),
          ], 'between'),
          ...containerNotices(),
          stats([
            stat('Upcoming', `{{ ${upcoming}.length }}`, 'calendar-days', loading('appointments')),
            stat('Today', `{{ ${upcoming}.filter(r => r.date === Date().slice(0, 10)).length }}`, 'clock', loading('appointments')),
            stat('Awaiting confirmation', `{{ ${upcoming}.filter(r => r.status === 'booked').length }}`, 'circle-dashed', loading('appointments')),
          ], 3),
          card('Today', [table(todayRows, appointmentColumns, 'No appointments today', true)]),
          card('Upcoming', [table(upcomingRows, appointmentColumns, 'No upcoming appointments', true)]),
        ]),
      },
    },
  }
}

function typesPage() {
  const typeRows = `{{ (data.types || []).filter(e => ${active}).map(t => ({ path: t.path, code: t.data.code || t.name, name: t.data.name || '', minutes: t.data.durationMinutes || 0, buffer: t.data.bufferMinutes || 0, host: t.data.host || '', active: t.data.active === false ? 'No' : 'Yes', appointments: (data.rows || []).filter(r => r.typePath === t.path).length, upcoming: ${upcoming}.filter(r => r.typePath === t.path).length, done: (data.rows || []).filter(r => r.typePath === t.path && r.status === 'done').length })).sort((a, b) => (a.name < b.name ? -1 : 1)) }}`
  return {
    file: 'types.page.yaml',
    document: {
      'api-version': 'canvas.verentis.io/v1', kind: 'Page',
      metadata: { id: 'appointments-types', name: 'Types', description: 'Every appointment type with its bookings.', icon: 'calendar-clock' },
      spec: {
        access: pageAccess('Summarise the appointments booked per type'),
        data: appointmentSources,
        tree: page([
          row([
            column([heading('Appointment types'), text('Every type with its duration, buffer and bookings. Click a type to open it.', 'muted')]),
            button('Appointments', [openFile(`${installRoot}/canvas/home.page.yaml`)], undefined, 'ghost', 'calendar-check'),
          ], 'between'),
          ...containerNotices(),
          stats(statuses.map(value => stat(statusLabel(value), countOf(`r.status === '${value}'`), 'calendar-check', loading('appointments'))), 3),
          card('By type', [table(typeRows, [['code', 'Type'], ['name', 'Name'], ['minutes', 'Minutes', 'end'], ['buffer', 'Buffer', 'end'],
            ['host', 'Host'], ['active', 'Active'], ['appointments', 'Appointments', 'end'], ['upcoming', 'Upcoming', 'end'], ['done', 'Done', 'end']],
          'No appointment types yet', true)]),
        ]),
      },
    },
  }
}

export function buildPages() {
  const documents = [homePage(), upcomingPage(), typesPage(), ...recordKinds.map(recordForm), settingsForm()]
  return Object.fromEntries(documents.map(({ file, document }) => [file, projectRegistration(document, `${installRoot}/canvas/${file}`)]))
}
