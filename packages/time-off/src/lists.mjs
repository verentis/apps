// Time Off views from the design: the team calendar, my requests, requests to approve, and the leave types.
import { calendar, listPage, mine } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

const requests = { container: containers.requests.path, mime: mimeTypes.request }
const columns = [['code', 'Request'], ['employee', 'Employee'], ['type', 'Type'], ['start', 'From', undefined, 'date'], ['end', 'To', undefined, 'date'], ['days', 'Days', 'end'], ['status', 'Status', undefined, 'badge']]
const row = "e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', type: String(e.data.type || '').split('/').pop(), start: e.data.startDate, end: e.data.endDate, days: e.data.days, status: e.data.status || 'draft' })"

export function listPages() {
  return [
    listPage({ file: 'calendar.page.yaml', id: 'time-off-calendar', name: 'Team calendar', description: "Who is off when; requests still to be decided are shown as submitted.", icon: 'calendar-days', ...requests,
      top: [calendar("{{ RECORDS.filter(e => e.data.status === 'approved' || e.data.status === 'submitted').map(e => ({ path: e.path, start: e.data.startDate, end: e.data.endDate, title: e.data.employeeName || e.data.code, status: e.data.status })) }}", { start: 'start', end: 'end', title: 'title', colorBy: 'status', view: 'month' })],
      rows: `RECORDS.filter(e => e.data.status === 'submitted').map(${row})`, columns, empty: 'No request is waiting for a decision.' }),
    // Theirs: linked to their Employees record (by work email), or carrying their name.
    listPage({ file: 'mine.page.yaml', id: 'time-off-mine', name: 'My requests', description: 'Your leave requests and where they stand.', icon: 'user', ...requests, me: true,
      rows: `RECORDS.filter(e => ${mine('employeeName', 'employeeRef')}).map(${row}).sort((a, b) => a.start < b.start ? 1 : -1)`, columns, empty: 'You have no leave requests.' }),
    listPage({ file: 'to-approve.page.yaml', id: 'time-off-to-approve', name: 'To approve', description: 'Submitted requests, with anyone else off at the same time.', icon: 'circle-check', ...requests,
      rows: `RECORDS.filter(e => e.data.status === 'submitted').map(e => ({ path: e.path, code: e.data.code || e.name, employee: e.data.employeeName || '', type: String(e.data.type || '').split('/').pop(), start: e.data.startDate, end: e.data.endDate, days: e.data.days,`
        + ` clash: RECORDS.filter(o => o.path !== e.path && (o.data.status === 'approved' || o.data.status === 'submitted') && o.data.startDate <= e.data.endDate && o.data.endDate >= e.data.startDate).map(o => o.data.employeeName).filter(n => n).join(', ') }))`,
      columns: [...columns.slice(0, 6), ['clash', 'Also off']], empty: 'Nothing to approve.' }),
    listPage({ file: 'types.page.yaml', id: 'time-off-types', name: 'Leave types', description: 'Days per year, and whether a request needs approval.', icon: 'tags', container: containers.types.path, mime: mimeTypes.type,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, name: e.data.name || '', days: e.data.daysPerYear, approval: e.data.requiresApproval ? 'Needs approval' : 'Automatic' }))",
      columns: [['code', 'Code'], ['name', 'Leave type'], ['days', 'Days per year', 'end'], ['approval', 'Approval', undefined, 'badge']], empty: 'No leave types yet.' }),
  ]
}
