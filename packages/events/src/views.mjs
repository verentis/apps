// What Events adds to its generated pages: capacity per event and the registration funnel.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const upcoming = "(data.rows || []).filter(r => ['published', 'ongoing'].includes(r.status))"

export const views = {
  'home.page.yaml': {
    top: [section('Capacity', [chart(`{{ ${upcoming}.map(r => ({ path: r.path, label: r.name || r.code, taken: r.taken || 0, left: Math.max(0, r.remaining || 0) })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['taken', 'left'], labels: { taken: 'Registered', left: 'Places left' }, palette: { taken: 'chart-1', left: 'muted' }, format: 'integer', emptyText: 'No published events' })],
    'Registered places against capacity for published and ongoing events.')],
  },
  'events.page.yaml': {
    label: 'Events', icon: 'kanban', count: `{{ ${upcoming}.length }}`,
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.events.path, script: postScriptPath, field: 'status', run: {published: 'publish', done: 'complete', cancelled: 'cancel'}, edit: true, final: ['done', 'cancelled'] },
  },
  'registrations.page.yaml': {
    label: 'Registrations', icon: 'ticket',
    // Door mode: one big search box and a large Check in button per match, for a tablet at the entrance.
    state: { door: '' },
    top: [section('Check-in', [
      { type: 'canvas.form.input', props: { label: 'Find an attendee', value: '{{ state.door }}', placeholder: 'Name or registration number' } },
      {
        type: 'canvas.repeat',
        props: {
          items: `{{ String(state.door || '').trim().length < 2 ? [] : (data.registrationrows || []).filter(r => r.status === 'confirmed' && [r.attendee, r.code].join(' ').toLowerCase().includes(String(state.door).trim().toLowerCase())).slice(0, 8) }}`,
          layout: 'list', emptyText: "{{ String(state.door || '').trim().length < 2 ? 'Type at least two letters' : 'No confirmed registration matches' }}",
        },
        children: [{
          type: 'canvas.stack', layout: { base: { direction: 'row', align: 'center', justify: 'space-between', gap: 3, padding: 2 } },
          children: [
            { type: 'canvas.stack', layout: { base: { gap: 0 } }, children: [
              { type: 'canvas.heading', props: { level: 3, text: '{{ item.attendee }}' } },
              { type: 'canvas.text', props: { tone: 'muted', text: "{{ [item.event, item.code, item.qty > 1 ? item.qty + ' places' : ''].filter(part => part).join(' · ') }}" } },
            ] },
            {
              type: 'canvas.button', props: { label: 'Check in', icon: 'check', size: 'lg' },
              on: { click: [
                { 'run-script': { file: postScriptPath, timeout: 60, parameters: { operation: 'check-in', path: '{{ item.path }}' }, assign: 'checkedin' } },
                { 'refresh-source': { source: 'registrations' } },
                { 'set-state': { key: 'door', value: '' } },
                { toast: { message: "{{ (state.checkedin && state.checkedin.message) || 'Checked in' }}", variant: 'success' } },
              ] },
            },
          ],
        }],
      },
    ], 'Search for a confirmed attendee and check them in. The box clears for the next person.')],
    bottom: [section('Registrations by status', [chart("{{ ['draft', 'confirmed', 'attended', 'cancelled'].map(status => ({ label: status, value: (data.registrationrows || []).filter(r => r.status === status).length })) }}",
      { kind: 'strip', x: 'label', y: 'value', labels: { draft: 'Draft', confirmed: 'Confirmed', attended: 'Attended', cancelled: 'Cancelled' }, palette: { draft: 'muted', confirmed: 'chart-1', attended: 'success', cancelled: 'danger' }, format: 'integer' })])],
  },
}
