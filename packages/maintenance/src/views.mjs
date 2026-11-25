// What Maintenance adds to its generated pages: the maintenance calendar.
import { calendar, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'equipment.page.yaml': { label: 'Equipment', icon: 'wrench' },
  'requests.page.yaml': {
    label: 'Requests', icon: 'kanban', count: "{{ (data.rows || []).filter(r => !['done', 'cancelled'].includes(r.stage)).length }}",
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.requests.path, script: postScriptPath, field: 'stage', run: {'in-progress': 'start-request', repaired: 'complete-request', scrap: 'scrap'}, edit: false, final: ['repaired', 'scrap'], confirm: {scrap: 'The equipment is marked as scrapped.'} },
  },
  'preventive.page.yaml': {
    label: 'Calendar', icon: 'calendar',
    top: [section('Maintenance calendar', [calendar("{{ (data.rows || []).filter(r => !!r.scheduledDate).map(r => ({ path: r.path, title: r.equipment || r.code, type: r.type, at: r.scheduledDate })) }}",
      { start: 'at', title: 'title', colorBy: 'type', view: 'month' })], 'Preventive and corrective requests by scheduled date.')],
  },
}
