// Planning views from the design: the day timeline by person, and the roles.
import { calendar, listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'day.page.yaml', id: 'planning-day', name: 'Day timeline', description: 'People by hours for a day, coloured by role.', icon: 'gantt-chart', container: containers.shifts.path, mime: mimeTypes.shift,
      top: [calendar("{{ RECORDS.filter(e => !!e.data.date).map(e => ({ path: e.path, start: e.data.date + 'T' + (e.data.startTime || '00:00'), end: e.data.date + 'T' + (e.data.endTime || e.data.startTime || '23:59'), title: e.data.employee || e.data.code, employee: e.data.employee || 'Unfilled', role: String(e.data.role || '').split('/').pop(), status: e.data.status })) }}",
        { start: 'start', end: 'end', title: 'title', colorBy: 'role', view: 'resource', views: ['resource', 'day', 'week'], resourceKey: 'employee' })],
      rows: "RECORDS.filter(e => (e.data.status || 'draft') === 'draft').map(e => ({ path: e.path, date: e.data.date, time: (e.data.startTime || '') + '–' + (e.data.endTime || ''), employee: e.data.employee || 'Unfilled', role: String(e.data.role || '').split('/').pop() })).sort((a, b) => a.date < b.date ? -1 : 1)",
      columns: [['date', 'Draft shift', undefined, 'date'], ['time', 'Time'], ['employee', 'Person'], ['role', 'Role']], empty: 'No draft shifts; every shift is published.' }),
    listPage({ file: 'roles.page.yaml', id: 'planning-roles', name: 'Roles', description: 'Roles with their colour and the hours planned this week.', icon: 'palette', container: containers.roles.path, mime: mimeTypes.role,
      extra: { shifts: { kind: 'folder', path: containers.shifts.path, contents: true, 'mime-pattern': mimeTypes.shift } },
      access: [{ path: containers.shifts.path, reason: 'Sum the hours planned per role' }],
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', color: e.data.color || '', shifts: (data.shifts || []).filter(s => s.data && s.data.role === e.path && s.data.date >= Date().slice(0, 10)).length }))",
      columns: [['code', 'Code'], ['name', 'Role'], ['color', 'Colour'], ['shifts', 'Upcoming shifts', 'end']], empty: 'No roles yet.' }),
  ]
}
