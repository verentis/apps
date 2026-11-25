// What CRM adds to its generated pages: the deal pipeline as a board and the open cases by priority.
import { board, chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'

const deals = "(data.deals || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && !e.data.outcome)"
const cases = "(data.cases || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived' && !['resolved', 'closed'].includes(e.data.status))"

export const views = {
  'home.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.deals.path, field: 'stageId', run: {}, edit: true },
    top: [
      section('Pipeline', [board(`{{ ${deals} }}`, 'data.stageId', [], { title: 'data.title', code: 'data.code', meta: ['data.owner', 'data.expectedCloseDate'], trailing: 'data.amount' },
        { labels: { lead: 'Lead', qualified: 'Qualified', proposal: 'Proposal', negotiation: 'Negotiation' }, emptyText: 'No open deals' })],
      'Open deals by stage. Open a deal to move it.'),
      section('Open cases by priority', [chart(`{{ ['urgent', 'high', 'normal', 'low'].map(priority => ({ label: priority, value: ${cases}.filter(e => (e.data.priority || 'normal') === priority).length })) }}`,
        { kind: 'strip', x: 'label', y: 'value', labels: { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }, palette: { urgent: 'danger', high: 'warning', normal: 'chart-1', low: 'muted' }, format: 'integer', emptyText: 'No open cases' })]),
    ],
  },
}
