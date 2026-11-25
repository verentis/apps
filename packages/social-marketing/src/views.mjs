// What Social Marketing adds to its generated pages: the content calendar and the engagement chart.
import { calendar, section, chart } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'upcoming.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.posts.path, script: postScriptPath, field: 'status', run: {scheduled: 'schedule', published: 'publish', cancelled: 'cancel'}, edit: false, final: ['published', 'cancelled'] },
    label: 'Calendar', icon: 'calendar',
    top: [section('Content calendar', [calendar("{{ (data.rows || []).filter(r => !!(r.scheduledDate || r.publishedAt)).map(r => ({ path: r.path, title: r.excerpt || r.code, handle: r.handle || 'No account', at: r.scheduledDate || r.publishedAt })) }}",
      { start: 'at', title: 'title', colorBy: 'handle', view: 'month' })], 'Scheduled and published posts per account.')],
  },
  'engagement.page.yaml': {
    label: 'Engagement', icon: 'chart-column',
    top: [section('Engagement per post', [chart("{{ (data.rows || []).filter(r => r.status === 'published').map(r => ({ label: r.code, likes: r.likes || 0, shares: r.shares || 0, comments: r.comments || 0 })) }}",
      { kind: 'stacked-bar', x: 'label', y: ['likes', 'shares', 'comments'], labels: { likes: 'Likes', shares: 'Shares', comments: 'Comments' }, format: 'integer', limit: 20 })])],
  },
}
