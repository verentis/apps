// Appointments views from the design: every appointment, any status.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'all.page.yaml', id: 'appointments-all', name: 'All appointments', description: 'Every appointment; filter by status.', icon: 'list', container: containers.appointments.path, mime: mimeTypes.appointment,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, date: e.data.date, time: (e.data.startTime || '') + '–' + (e.data.endTime || ''), guest: e.data.guestName || '', type: String(e.data.type || '').split('/').pop(), host: e.data.host || '', status: e.data.status || 'booked' })).sort((a, b) => (a.date + a.time) < (b.date + b.time) ? 1 : -1)",
      columns: [['code', 'Appointment'], ['date', 'Date', undefined, 'date'], ['time', 'Time'], ['guest', 'Guest'], ['type', 'Type'], ['host', 'Host'], ['status', 'Status', undefined, 'badge']], empty: 'No appointments yet.' }),
  ]
}
