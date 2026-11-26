// Project views from the design: every task as a table, grouped by project.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'tasks.page.yaml', id: 'project-tasks', name: 'Tasks', description: 'Every task with its project, stage, assignee and due date.', icon: 'list-checks', container: containers.tasks.path, mime: mimeTypes.task,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', project: String(e.data.project || '').split('/').pop(), stage: e.data.stage || 'backlog', priority: e.data.priority || '', assignee: e.data.assignee || '', due: e.data.dueDate || '' })).sort((a, b) => (a.project + a.due) < (b.project + b.due) ? -1 : 1)",
      columns: [['code', 'Task'], ['title', 'Title'], ['project', 'Project'], ['stage', 'Stage', undefined, 'badge'], ['priority', 'Priority', undefined, 'badge'], ['assignee', 'Assignee'], ['due', 'Due', undefined, 'date']], empty: 'No tasks yet.' }),
  ]
}
