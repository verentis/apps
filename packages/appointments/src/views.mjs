// What Appointments adds to its generated pages: the calendar of booked and confirmed appointments.
import { calendar, section } from '../../../tools/file-apps/canvas.mjs'

const dated = "(data.rows || []).filter(r => !!r.date).map(r => ({ path: r.path, title: [r.time, r.guest].filter(part => part).join(' · '), host: r.host || 'No host', status: r.status, at: r.date + (r.start ? 'T' + r.start : '') }))"

export const views = {
  'home.page.yaml': { label: 'Overview' },
  'upcoming.page.yaml': {
    label: 'Calendar', icon: 'calendar',
    top: [section('Calendar', [calendar(`{{ ${dated} }}`, { start: 'at', title: 'title', colorBy: 'host', view: 'week', views: ['week', 'month', 'agenda'] })], 'Appointments by host.')],
  },
  'types.page.yaml': { label: 'Types', icon: 'shapes' },
}
