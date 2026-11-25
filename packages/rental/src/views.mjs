// What Rental adds to its generated pages: the booking timeline and the availability chart.
import { chart, openRow, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'

const bookings = "(data.bookings || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && !!e.data.startDate && e.data.status !== 'cancelled')"

export const views = {
  'availability.page.yaml': {
    label: 'Availability', icon: 'calendar-range',
    writes: [containers.bookings.path],
    top: [
      section('Bookings', [{
        type: 'canvas.gantt',
        props: {
          rows: `{{ ${bookings}.map(e => ({ path: e.path, title: [e.data.code, e.data.customerName].filter(part => part).join(' · '), status: e.data.status, start: e.data.startDate, end: e.data.endDate || e.data.startDate, product: ((((data.products || []).find(p => p.path === e.data.product) || {}).data || {}).name) || 'No product' })) }}`,
          laneKey: 'product', lanes: "{{ (data.products || []).filter(p => p.kind === 'file' && p.data && p.data.state !== 'archived').map(p => p.data.name || p.data.code) }}",
          colorBy: 'status', days: 21, conflicts: false,
          // Only drafts move: a confirmed booking's dates are its contract (the booking script recomputes totals on confirm).
          lockedWhen: "row.status !== 'draft'",
        },
        on: {
          open: openRow,
          reschedule: [
            { 'patch-record': { path: '{{ event.path }}', values: { startDate: '{{ event.start }}', endDate: '{{ event.end }}', updatedAt: '{{ Date() }}' } } },
            { 'refresh-source': { source: 'bookings' } },
          ],
        },
      }], 'Bookings per product, from pick-up to return. Drag a draft booking to change its dates.'),
      section('Units out and available', [chart("{{ (data.availability || []).map(p => ({ label: p.name || p.code, out: p.out || 0, available: Math.max(0, p.available || 0) })) }}",
        { kind: 'stacked-hbar', x: 'label', y: ['out', 'available'], labels: { out: 'Out', available: 'Available' }, palette: { out: 'warning', available: 'success' }, format: 'integer' })]),
    ],
  },
  'bookings.page.yaml': { label: 'Bookings', icon: 'list' },
  'revenue.page.yaml': { label: 'Revenue', icon: 'chart-column' },
}
