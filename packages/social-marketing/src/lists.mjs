// Social Marketing views from the design: the content calendar and the connected channels.
import { calendar, listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'calendar.page.yaml', id: 'social-calendar', name: 'Content calendar', description: 'Posts by day per channel.', icon: 'calendar-days', container: containers.posts.path, mime: mimeTypes.post,
      top: [calendar("{{ RECORDS.filter(e => !!(e.data.scheduledDate || e.data.publishedAt)).map(e => ({ path: e.path, start: e.data.scheduledDate || e.data.publishedAt, title: String(e.data.content || e.data.code).slice(0, 60), channel: String(e.data.account || '').split('/').pop(), status: e.data.status })) }}", { start: 'start', title: 'title', colorBy: 'channel', view: 'month' })],
      rows: "RECORDS.filter(e => !e.data.scheduledDate && (e.data.status || 'draft') === 'draft').map(e => ({ path: e.path, code: e.data.code || e.name, content: String(e.data.content || '').slice(0, 80), channel: String(e.data.account || '').split('/').pop() }))",
      columns: [['code', 'Post'], ['content', 'Unscheduled draft'], ['channel', 'Channel']], empty: 'Every draft has a date.' }),
    listPage({ file: 'channels.page.yaml', id: 'social-channels', name: 'Channels', description: 'The connected social accounts.', icon: 'radio-tower', container: containers.accounts.path, mime: mimeTypes.account,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, network: e.data.network || '', handle: e.data.handle || '', active: e.data.active === false ? 'Paused' : 'Active' }))",
      columns: [['code', 'Code'], ['network', 'Network'], ['handle', 'Handle'], ['active', 'Status', undefined, 'badge']], empty: 'No channels yet.' }),
  ]
}
