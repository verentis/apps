// What Field Service adds to its generated pages: the day calendar per technician and load per technician.
import { appOperationsSource, calendar, callAppSteps, chart, openRow, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const open = "(data.rows || []).filter(r => ['new', 'scheduled', 'on-site'].includes(r.stage))"

// Completing on the board asks Invoicing to draft the task's invoice, as the task form does (see callAppSteps).
const taskInvoice = callAppSteps({ app: 'invoicing', operation: 'create-draft-invoice', script: postScriptPath, recordOperation: 'record-invoice',
  result: 'lastmove', path: '{{ event.path }}', key: "'task-' + event.row.data.code" })

export const views = {
  'home.page.yaml': {
    label: 'Today',
    bottom: [section('Map', [
      {
        type: 'canvas.map',
        props: {
          height: 320, fit: 'all', showLegend: true,
          layers: [{ kind: 'pins', rows: { $expr: "(data.rows || []).filter(r => ['new', 'scheduled', 'on-site'].includes(r.stage) && r.latitude !== '' && r.longitude !== '' && r.latitude != null).map(r => ({ path: r.path, id: r.path, lat: Number(r.latitude), lng: Number(r.longitude), label: [r.window, r.customer].filter(part => part).join(' · '), technician: r.technician || 'Unassigned' }))" }, lat: 'lat', lng: 'lng', label: 'label', colorBy: 'technician' }],
        },
        on: { open: openRow },
      },
      { ...{ type: 'canvas.text', props: { text: "{{ (data.rows || []).filter(r => ['new', 'scheduled', 'on-site'].includes(r.stage) && !(r.latitude && r.longitude)).length + ' open tasks have no location yet; add latitude and longitude on the task to place them.' }}", tone: 'muted' } }, rules: { visible: "(data.rows || []).some(r => ['new', 'scheduled', 'on-site'].includes(r.stage) && !(r.latitude && r.longitude))" } },
    ], 'Open tasks by technician. Tasks appear once they have a latitude and longitude.')],
    top: [section('Schedule', [calendar("{{ (data.rows || []).filter(r => !!r.date && r.stage !== 'cancelled').map(r => ({ path: r.path, title: [r.window, r.customer].filter(part => part).join(' · '), technician: r.technician || 'Unassigned', at: r.date + (r.windowStart ? 'T' + r.windowStart : '') })) }}",
      { start: 'at', title: 'title', colorBy: 'technician', view: 'day', views: ['day', 'week', 'agenda'] })], 'Tasks by technician and arrival window.')],
  },
  'schedule.page.yaml': {
    label: 'Technicians', icon: 'hard-hat',
    bottom: [section('Open tasks per technician', [chart(`{{ ${open}.map(r => r.technician || 'Unassigned').filter((name, index, all) => all.indexOf(name) === index).map(name => ({ label: name, value: ${open}.filter(r => (r.technician || 'Unassigned') === name).length })) }}`,
      { kind: 'hbar', x: 'label', y: 'value', format: 'integer', sort: '-value' })])],
  },
  'tasks.page.yaml': {
    label: 'All tasks', icon: 'kanban', count: `{{ ${open}.length }}`,
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    data: { ...appOperationsSource },
    moves: { container: containers.tasks.path, script: postScriptPath, field: 'stage', run: {scheduled: 'schedule', 'on-site': 'start', done: { operation: 'complete', then: taskInvoice }, cancelled: 'cancel'}, edit: false, final: ['done', 'cancelled'] },
  },
}
