// What Planning adds to its generated pages: the week as a rota (people × days), today as a timeline (people ×
// hours) where draft shifts are dragged to a new time, and shifts per person.
import { chart, openRow, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const dated = "(data.rows || []).filter(r => !!r.date && r.status !== 'cancelled')"
const days = "Array.from({ length: 7 }, (_, i) => Date(Date.now() + i * 86400000).slice(0, 10))"
const today = 'Date().slice(0, 10)'

export const views = {
  'week.page.yaml': {
    label: 'Week', icon: 'calendar',
    top: [section('Rota', [{
      type: 'canvas.matrix',
      props: {
        rows: `{{ ${dated}.map(r => ({ path: r.path, employee: r.employee || 'Unassigned', date: r.date, role: r.role || 'No role', label: [r.time, r.role].filter(part => part).join(' ') + (r.status === 'draft' ? ' · draft' : '') })) }}`,
        rowKey: 'employee', columnKey: 'date', mode: 'items', item: 'label', colorBy: 'role', rowHeading: 'Person',
        columns: `{{ ${days}.map(d => ({ value: d, label: format(d, 'date') })) }}`,
        emptyText: 'No shifts in the next seven days.',
      },
      on: { open: openRow },
    }], 'Who works when over the next seven days. Draft shifts are marked; open one to change it.')],
  },
  'shifts.page.yaml': {
    label: 'Shifts', icon: 'list', count: "{{ (data.rows || []).filter(r => r.status === 'draft').length }}",
    writes: [containers.shifts.path],
    // Publish week: every draft shift of the next seven days is checked first (a time, and no overlap with the
    // same person's other shifts); the clean ones are then published one by one through the publish script.
    top: [{
      type: 'canvas.stack', layout: { base: { direction: 'row', justify: 'end' } },
      children: [{
        type: 'canvas.button',
        props: { label: 'Publish week', icon: 'send', disabled: { $expr: "(data.rows || []).filter(r => r.status === 'draft' && !!r.date && r.date >= Date().slice(0, 10) && r.date <= Date(Date.now() + 6 * 86400000).slice(0, 10)).length === 0" }, reason: 'No draft shifts in the next seven days' },
        on: { click: [
          { preflight: {
            title: 'Publish the week', assign: 'publishable', partial: true,
            label: "{{ item.employee }} · {{ format(item.date, 'date') }} {{ item.time }}",
            items: "{{ (data.rows || []).filter(r => r.status === 'draft' && !!r.date && r.date >= Date().slice(0, 10) && r.date <= Date(Date.now() + 6 * 86400000).slice(0, 10)) }}",
            check: "!item.start || !item.end ? { fail: 'Has no start or end time' } : (data.rows || []).find(o => o.path !== item.path && o.status !== 'cancelled' && o.employee === item.employee && o.date === item.date && o.start < item.end && item.start < o.end) ? { fail: 'Overlaps ' + (data.rows || []).find(o => o.path !== item.path && o.status !== 'cancelled' && o.employee === item.employee && o.date === item.date && o.start < item.end && item.start < o.end).code + ' (' + (data.rows || []).find(o => o.path !== item.path && o.status !== 'cancelled' && o.employee === item.employee && o.date === item.date && o.start < item.end && item.start < o.end).time + ')' } : !item.role ? { warn: 'Has no role' } : true",
          } },
          { 'for-each': { items: '{{ state.publishable.apply }}', as: 'shift', assign: 'published', steps: [
            { 'run-script': { file: postScriptPath, timeout: 60, parameters: { operation: 'publish', path: '{{ shift.path }}' } } },
          ] } },
          { 'refresh-source': { source: 'shifts' } },
          { toast: { message: "{{ 'Published ' + state.published.count + ' shifts' + (state.publishable.skipped && state.publishable.skipped.length ? '; ' + state.publishable.skipped.length + ' left as drafts' : '') }}", variant: 'success' } },
        ] },
      }],
    }, section('Today', [{
      type: 'canvas.gantt',
      props: {
        rows: `{{ ${dated}.filter(r => r.date === ${today} && !!r.start).map(r => ({ path: r.path, title: [r.role, r.time].filter(part => part).join(' · '), employee: r.employee || 'Unassigned', role: r.role || 'No role', status: r.status, start: r.date + 'T' + r.start, end: r.date + 'T' + (r.end || r.start) })) }}`,
        laneKey: 'employee', colorBy: 'role', scale: 'hour', hours: [6, 22], conflicts: true, lockedWhen: "row.status !== 'draft'",
        emptyText: 'No shifts today.',
      },
      on: {
        open: openRow,
        // Only draft shifts move; published and confirmed ones are changed through their form.
        reschedule: [
          { 'patch-record': { path: '{{ event.path }}', values: { startTime: '{{ event.start.slice(11, 16) }}', endTime: '{{ event.end.slice(11, 16) }}', updatedAt: '{{ Date() }}' } } },
          { 'refresh-source': { source: 'shifts' } },
        ],
      },
    }], 'People across the hours of today. Drag a draft shift to move it, or its right edge to change when it ends.')],
    bottom: [section('Shifts per person', [chart(
      `{{ ${dated}.map(r => r.employee || 'Unassigned').filter((name, index, all) => all.indexOf(name) === index).map(name => ({ label: name, draft: ${dated}.filter(r => (r.employee || 'Unassigned') === name && r.status === 'draft').length, published: ${dated}.filter(r => (r.employee || 'Unassigned') === name && r.status !== 'draft').length })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['draft', 'published'], labels: { draft: 'Draft', published: 'Published' }, palette: { draft: 'warning', published: 'chart-1' }, format: 'integer' },
    )])],
  },
}
