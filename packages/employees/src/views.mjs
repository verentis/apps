// What Employees adds to its generated pages: the people grid and headcount per department.
import { chart, openRow, repeat, section } from '../../../tools/file-apps/canvas.mjs'

const current = "(data.rows || []).filter(r => r.status !== 'terminated')"

export const views = {
  'home.page.yaml': {
    top: [section('Headcount by department', [chart(`{{ ${current}.map(r => r.department || 'No department').filter((name, index, all) => all.indexOf(name) === index).map(name => ({ label: name, active: ${current}.filter(r => (r.department || 'No department') === name && r.status === 'active').length, leave: ${current}.filter(r => (r.department || 'No department') === name && r.status === 'on-leave').length })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['active', 'leave'], labels: { active: 'Active', leave: 'On leave' }, palette: { active: 'chart-1', leave: 'warning' }, format: 'integer' })])],
  },
  'directory.page.yaml': {
    label: 'Directory', icon: 'users',
    top: [repeat(`{{ ${current} }}`, [{
      type: 'canvas.card', props: { title: '{{ item.name || item.code }}', description: "{{ [item.jobTitle, item.manager ? 'Reports to ' + item.manager : ''].filter(part => part).join(' · ') }}", clickable: true },
      on: { click: [{ 'open-file': { path: '{{ item.path }}', mode: 'edit', open: 'side' } }] },
      children: [{ type: 'canvas.dashboard.badge', props: { value: '{{ item.status }}', labels: { 'active': 'Active', 'on-leave': 'On leave' }, tones: { 'active': 'success', 'on-leave': 'warning' } } }],
    }], { groupBy: 'department', columns: 3, emptyText: 'No employees yet' })],
  },
  'departments.page.yaml': {
    label: 'Departments', icon: 'network',
    bottom: [section('Org chart', [{
      type: 'canvas.org-chart',
      props: {
        rows: "{{ (data.staff || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && e.data.status !== 'terminated').map(e => ({ path: e.path, name: e.data.name || e.data.code, title: e.data.jobTitle, manager: e.data.manager, status: e.data.status })) }}",
        idKey: 'path', managerKey: 'manager', title: 'name', subtitle: 'title', depth: 3,
        badge: { key: 'status', labels: { 'active': 'Active', 'on-leave': 'On leave' }, tones: { 'active': 'success', 'on-leave': 'warning' } },
      },
      on: { open: openRow },
    }], 'Who reports to whom, from each employee’s manager. Open a person to edit them.')],
  },
}
