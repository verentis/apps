// What Recruitment adds to its generated pages: the hiring funnel.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'home.page.yaml': {
    top: [section('Hiring funnel', [chart("{{ ['new', 'screening', 'interview', 'offer', 'hired'].map(stage => ({ label: stage, value: (data.rows || []).filter(r => r.stage === stage).length })) }}",
      { kind: 'funnel', x: 'label', y: 'value', labels: { new: 'New', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired' }, format: 'integer', emptyText: 'No candidates yet' })])],
  },
  'pipeline.page.yaml': {
    label: 'Pipeline', icon: 'kanban', count: "{{ (data.rows || []).filter(r => ['new', 'screening', 'interview', 'offer'].includes(r.stage)).length }}",
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.candidates.path, script: postScriptPath, field: 'stage', run: {hired: 'hire', refused: 'refuse'}, edit: true, final: ['hired', 'refused'] },
  },
  'positions.page.yaml': { label: 'Jobs', icon: 'briefcase' },
}
