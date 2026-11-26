// The Helpdesk queue views the design lists in the sidebar: Mine, Unassigned, Overdue, Waiting and Solved.
import { listPage, mine } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

const columns = [['code', 'Ticket'], ['subject', 'Subject'], ['customer', 'Customer'], ['priority', 'Priority', undefined, 'badge'],
  ['stage', 'Stage', undefined, 'badge'], ['assignee', 'Assignee'], ['sla', 'SLA', undefined, 'datetime']]
const rows = filter => `RECORDS.filter(e => ${filter}).map(e => ({ path: e.path, code: e.data.code || e.name, subject: e.data.subject || '', customer: e.data.customerName || '',`
  + ` priority: e.data.priority || '', stage: e.data.stage || '', assignee: e.data.assignee || '', sla: e.data.slaDeadline || '' }))`
  + `.sort((a, b) => (a.sla || '9') < (b.sla || '9') ? -1 : 1)`
const open = "['new', 'in-progress', 'waiting'].includes(e.data.stage || 'new')"
const queue = (file, id, name, description, icon, filter, empty, me = false) => listPage({
  file, id: `helpdesk-${id}`, name, description, icon, container: containers.tickets.path, mime: mimeTypes.ticket, rows: rows(filter), columns, empty, me,
})

export function listPages() {
  return [
    // Theirs: linked to their Employees record (by work email), or carrying their name.
    queue('mine.page.yaml', 'mine', 'Mine', 'Open tickets assigned to you, by SLA.', 'user', `${open} && ${mine('assignee', 'assigneeRef')}`, 'Nothing assigned to you.', true),
    queue('unassigned.page.yaml', 'unassigned', 'Unassigned', 'Open tickets nobody has picked up yet.', 'inbox', `${open} && !e.data.assignee && !e.data.assigneeRef`, 'Every open ticket has an assignee.'),
    queue('overdue.page.yaml', 'overdue', 'Overdue', 'Open tickets past their SLA deadline, most overdue first.', 'alarm-clock-off', `${open} && !!e.data.slaDeadline && e.data.slaDeadline < Date()`, 'No ticket is past its SLA.'),
    queue('waiting.page.yaml', 'waiting', 'Waiting', 'Tickets waiting on the customer or a supplier.', 'hourglass', "e.data.stage === 'waiting'", 'Nothing is waiting.'),
    queue('solved.page.yaml', 'solved', 'Solved', 'Solved tickets waiting to be closed.', 'circle-check', "e.data.stage === 'solved'", 'No solved ticket is waiting to be closed.'),
  ]
}
