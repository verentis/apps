// What Helpdesk adds to its generated pages: queue counts in the sidebar, the deadline strip on the SLA report and
// the workload chart. See `appNavigation` in tools/file-apps/canvas.mjs.
import { section, chart, timeStrip } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const open = "(data.rows || []).filter(r => !['solved', 'closed'].includes(r.stage))"

export const views = {
  'home.page.yaml': { label: 'Queue', icon: 'inbox', count: `{{ ${open}.length }}` },
  'tickets.page.yaml': {
    label: 'Board', icon: 'kanban',
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.tickets.path, script: postScriptPath, field: 'stage', run: { solved: { operation: 'resolve', ask: [{ key: 'resolution', label: 'Resolution', type: 'textarea', required: true, description: 'What was done. The customer sees this.' }] }, closed: 'close' }, edit: true, final: ['closed'], confirm: {closed: 'A closed ticket can no longer be edited.'} },
  },
  'sla.page.yaml': {
    label: 'SLA', icon: 'alarm-clock', count: `{{ ${open}.filter(r => r.overdue).length }}`, tone: 'danger',
    top: [section('Next 48 hours', [timeStrip(`{{ ${open}.filter(r => !!r.deadline) }}`, { at: 'deadline', title: 'subject', window: { from: '-12h', to: '48h' }, soon: '4h' })],
      'Open tickets on their SLA deadline. Overdue is left of now; due soon means within 4 hours.')],
  },
  'workload.page.yaml': {
    label: 'Workload', icon: 'users',
    top: [section('Open tickets per assignee', [chart(
      `{{ ${open}.map(r => r.assignee || 'Unassigned').filter((name, index, all) => all.indexOf(name) === index).map(name => ({ label: name, overdue: ${open}.filter(r => (r.assignee || 'Unassigned') === name && r.overdue).length, ontrack: ${open}.filter(r => (r.assignee || 'Unassigned') === name && !r.overdue).length })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['overdue', 'ontrack'], labels: { overdue: 'Overdue', ontrack: 'On track' }, palette: { overdue: 'danger', ontrack: 'chart-1' }, format: 'integer' },
    )])],
  },
}
