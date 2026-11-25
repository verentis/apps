// What Referrals adds to its generated pages: points on the leaderboard.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const names = "(data.rows || []).map(r => r.referrer || 'Unknown').filter((name, index, all) => all.indexOf(name) === index)"

export const views = {
  'home.page.yaml': { label: 'My referrals' },
  'referrals.page.yaml': {
    label: 'All referrals', icon: 'kanban',
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.referrals.path, script: postScriptPath, field: 'status', run: {hired: 'mark-hired', 'not-hired': 'mark-not-hired'}, edit: true, final: ['hired', 'not-hired'], confirm: {hired: 'The referrer is awarded their points.'} },
  },
  'leaderboard.page.yaml': {
    label: 'Leaderboard', icon: 'trophy',
    top: [section('Points earned', [chart(`{{ ${names}.map(name => ({ label: name, value: (data.rows || []).filter(r => (r.referrer || 'Unknown') === name).reduce((sum, r) => sum + (Number(r.points) || 0), 0) })) }}`,
      { kind: 'hbar', x: 'label', y: 'value', format: 'integer', sort: '-value' })])],
  },
}
