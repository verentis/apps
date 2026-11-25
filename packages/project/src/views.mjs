// What Project adds to its generated pages: the task board and the due-date timeline.
import { board, openRow, row, section, timeStrip } from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, templates } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const tasks = "(data.tasks || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')"

// Swimlane rows carry the project's name, so lanes read as project names.
const projectName = path => `((((data.projects || []).find(p => p.path === ${path}) || {}).data || {}).name || '')`

/** The task board with swimlanes chosen above it, and an Add under each column that creates a task in that stage. */
function withQuickAdd(node) {
  return {
    ...node,
    props: {
      ...node.props,
      rows: `{{ ${tasks}.map(e => ({ path: e.path, name: e.name, kind: e.kind, data: e.data, project: ${projectName('e.data.project')} || 'No project' })) }}`,
      laneBy: '{{ state.lanes }}', allowAdd: true,
    },
    on: {
      ...node.on,
      add: [
        { 'run-script': {
          file: `${installRoot}/scripts/create`, timeout: 60, assign: 'created',
          parameters: {
            operation: 'create', creatable: 'task', parentPath: containers.tasks.path, mime: mimeTypes.task,
            template: { $expr: `'${JSON.stringify(templates.task).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` }, siblings: "{{ (data.tasks || []).map(e => e.name) }}",
          },
        } },
        // The new task starts in the column it was added under, for the lane's assignee when lanes are by assignee.
        { 'patch-record': { path: '{{ state.created.path }}', values: { stage: '{{ event.column }}', updatedAt: '{{ Date() }}' } } },
        { 'patch-record': { if: "state.lanes === 'data.assignee' && !!event.lane", path: '{{ state.created.path }}', values: { assignee: '{{ event.lane }}' } } },
        { 'refresh-source': { source: 'tasks' } },
        { 'open-file': { path: '{{ state.created.path }}' } },
      ],
    },
  }
}

export const views = {
  'home.page.yaml': {
    label: 'Projects',
    top: [section('Due dates', [timeStrip(`{{ ${tasks}.filter(e => e.data.stage !== 'done' && !!e.data.dueDate).map(e => ({ path: e.path, title: e.data.title || e.data.code, at: e.data.dueDate })) }}`,
      { at: 'at', title: 'title', window: { from: '-7d', to: '28d' }, soon: '2d' })], 'Open tasks by due date. Late tasks are left of today.')],
  },
  'board.page.yaml': {
    bottom: [section('Timeline', [{
      type: 'canvas.gantt',
      props: {
        rows: `{{ ${tasks}.filter(e => !!e.data.dueDate).map(e => ({ path: e.path, title: e.data.title || e.data.code, stage: e.data.stage, start: String(e.data.createdAt || e.data.dueDate).slice(0, 10), end: e.data.dueDate, project: ((((data.projects || []).find(p => p.path === e.data.project) || {}).data || {}).name) || 'No project' })) }}`,
        laneKey: 'project', colorBy: 'stage', days: 28, conflicts: false, lockedWhen: "row.stage === 'done'",
      },
      on: {
        open: openRow,
        // Moving or stretching a bar changes when the task is due; when it was created stays as it was.
        reschedule: [
          { 'patch-record': { path: '{{ event.path }}', values: { dueDate: '{{ event.end }}', updatedAt: '{{ Date() }}' } } },
          { 'refresh-source': { source: 'tasks' } },
        ],
      },
    }], 'Tasks from when they were created to when they are due. Drag a bar to change its due date.')],
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.tasks.path, script: postScriptPath, field: 'stage', run: {done: 'complete-task'}, edit: true, final: ['done'], confirm: {done: 'A completed task is locked.'} },
    label: 'Board', icon: 'kanban', count: `{{ ${tasks}.filter(e => e.data.stage !== 'done').length }}`,
    state: { lanes: '' },
    top: [
      row([{
        type: 'canvas.form.select',
        props: { label: 'Lanes', value: '{{ state.lanes }}', options: [{ value: '', label: 'None' }, { value: 'project', label: 'By project' }, { value: 'data.assignee', label: 'By assignee' }] },
      }], 'end'),
      withQuickAdd(board(`{{ ${tasks} }}`, 'data.stage', [{ value: 'backlog', label: 'Backlog' }, { value: 'in-progress', label: 'In progress' }, { value: 'review', label: 'Review' }, { value: 'done', label: 'Done' }], { title: 'data.title', code: 'data.code', meta: ['data.assignee', 'data.dueDate'], badge: 'data.priority' })),
    ],
  },
}
