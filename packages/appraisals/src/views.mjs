// What Appraisals adds to its generated pages: scores for the cycle.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': { label: 'Current cycle' },
  'appraisals.page.yaml': {
    label: 'Cycle board', icon: 'kanban', count: "{{ (data.rows || []).filter(r => r.status === 'scheduled').length }}",
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.appraisals.path, script: postScriptPath, field: 'status', run: {scheduled: 'schedule', done: 'complete'}, edit: true, final: ['done'], confirm: {done: 'The overall score is computed and the appraisal is locked.'} },
  },
  'scores.page.yaml': {
    label: 'Scores', icon: 'star',
    top: [section('Overall score', [chart("{{ (data.rows || []).filter(r => r.status === 'done' && r.overallScore != null && r.overallScore !== '').map(r => ({ path: r.path, label: r.employee || r.code, value: Number(r.overallScore) })) }}",
      { kind: 'hbar', x: 'label', y: 'value', format: 'number', decimals: 1, sort: '-value', emptyText: 'No completed appraisals yet' })], 'Completed appraisals, highest first.')],
  },
}
