// Timesheets views from the design: entries to validate, by person.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'to-validate.page.yaml', id: 'timesheets-to-validate', name: 'To validate', description: "The team's draft entries with hours, by person; open one to validate it.", icon: 'check-check',
      container: containers.entries.path, mime: mimeTypes.entry,
      rows: "RECORDS.filter(e => (e.data.status || 'draft') === 'draft' && Number(e.data.hours || 0) > 0).map(e => ({ path: e.path, employee: e.data.employee || '', date: e.data.date, project: String(e.data.project || '').split('/').pop(), task: e.data.task || '', hours: e.data.hours })).sort((a, b) => (a.employee + a.date) < (b.employee + b.date) ? -1 : 1)",
      columns: [['employee', 'Person'], ['date', 'Date', undefined, 'date'], ['project', 'Project'], ['task', 'Task'], ['hours', 'Hours', 'end']], empty: 'No draft entry is waiting.' }),
  ]
}
