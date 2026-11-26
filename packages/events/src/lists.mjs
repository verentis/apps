// Events views from the design: check-in at the door, with big buttons.
import { listPage, repeat, row, column, text, button } from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const live = "RECORDS.filter(e => e.data.status === 'confirmed')"
export function listPages() {
  return [
    listPage({ file: 'check-in.page.yaml', id: 'events-check-in', name: 'Check-in', description: 'Door mode: find a confirmed registration and check it in.', icon: 'scan-line',
      container: containers.registrations.path, mime: mimeTypes.registration, state: { find: '' }, permissions: ['execution.run', 'execution.read'],
      access: [{ path: `${installRoot}/`, reason: 'Run the check-in script' }],
      top: [
        { type: 'canvas.form.input', props: { label: '', placeholder: 'Search by name or email', value: '{{ state.find }}' } },
        repeat(`{{ ${live}.filter(e => !state.find || ((e.data.attendeeName || '') + ' ' + (e.data.attendeeEmail || '')).toLowerCase().includes(state.find.toLowerCase())).slice(0, 30).map(e => ({ path: e.path, name: e.data.attendeeName || e.data.code, email: e.data.attendeeEmail || '', qty: e.data.qty || 1, event: String(e.data.event || '').split('/').pop() })) }}`, [
          row([column([text('{{ item.name }}'), text("{{ item.event + ' · ' + item.qty + ' × · ' + item.email }}", 'muted')]),
            button('Check in', [
              { 'run-script': { file: postScriptPath, timeout: 60, parameters: { operation: 'check-in', path: '{{ item.path }}' }, assign: 'checked' } },
              { 'refresh-source': { source: 'records' } },
              { toast: { message: "{{ (state.checked && state.checked.message) || 'Checked in' }}", variant: 'success' } },
            ], undefined, undefined, 'check')], 'between'),
        ], { layout: 'list', emptyText: 'No confirmed registration matches.' }),
      ],
      rows: "RECORDS.filter(e => e.data.status === 'attended').map(e => ({ path: e.path, name: e.data.attendeeName || e.data.code, event: String(e.data.event || '').split('/').pop(), qty: e.data.qty }))",
      columns: [['name', 'Checked in'], ['event', 'Event'], ['qty', 'Tickets', 'end']], empty: 'Nobody checked in yet.' }),
  ]
}
