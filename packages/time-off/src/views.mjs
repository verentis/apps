// What Time Off adds to its generated pages: the team calendar and the balance chart.
import { calendar, section, chart } from '../../../tools/file-apps/canvas.mjs'

const active = "(data.rows || []).filter(r => !!r.startDate && !['refused', 'cancelled'].includes(r.status))"

export const views = {
  'home.page.yaml': {
    top: [section('Team calendar', [calendar(`{{ ${active}.map(r => ({ path: r.path, title: [r.employee, r.type].filter(part => part).join(' · '), employee: r.employee || 'Unassigned', status: r.status, at: r.startDate, until: r.endDate || r.startDate })) }}`,
      { start: 'at', end: 'until', title: 'title', colorBy: 'status', view: 'resource', views: ['resource', 'month', 'agenda'], resourceKey: 'employee' })], 'Who is off when, one row per person. Requests still waiting for a decision are coloured apart.')],
  },
  'requests.page.yaml': { label: 'Requests', icon: 'kanban', count: "{{ (data.rows || []).filter(r => r.status === 'submitted').length }}" },
  'allocations.page.yaml': {
    label: 'Balances', icon: 'scale',
    top: [section('Days taken against allocation', [chart("{{ (data.summary || []).map(s => ({ label: s.type, taken: s.taken || 0, left: Math.max(0, (s.allocated || 0) - (s.taken || 0)) })) }}",
      { kind: 'stacked-hbar', x: 'label', y: ['taken', 'left'], labels: { taken: 'Taken', left: 'Left' }, palette: { taken: 'chart-1', left: 'muted' }, format: 'number' })])],
  },
}
