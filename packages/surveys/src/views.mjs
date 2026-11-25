// What Surveys adds to its generated pages: responses per survey.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'surveys.page.yaml': {
    label: 'Surveys', icon: 'kanban',
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.surveys.path, script: postScriptPath, field: 'status', run: {open: 'open', closed: 'close'}, edit: true, final: ['closed'] },
  },
  'results.page.yaml': {
    label: 'Results', icon: 'chart-column',
    top: [section('Responses per survey', [chart("{{ (data.rows || []).map(r => ({ path: r.path, label: r.title || r.code, submitted: r.submitted || 0, drafts: r.drafts || 0 })) }}",
      { kind: 'stacked-hbar', x: 'label', y: ['submitted', 'drafts'], labels: { submitted: 'Submitted', drafts: 'Still drafts' }, palette: { submitted: 'chart-1', drafts: 'muted' }, format: 'integer' })])],
  },
}
