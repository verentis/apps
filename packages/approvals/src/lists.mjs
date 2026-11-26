// Approvals views from the design: what I asked for.
import { listPage, mine } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    // Theirs: linked to their Employees record (by work email), or carrying their name.
    listPage({ file: 'mine.page.yaml', id: 'approvals-mine', name: 'My requests', description: 'What you asked for, and where it stands.', icon: 'user',
      container: containers.requests.path, mime: mimeTypes.request, me: true,
      rows: "RECORDS.filter(e => " + mine('requester', 'requesterRef') + ").map(e => ({ path: e.path, code: e.data.code || e.name, title: e.data.title || '', type: String(e.data.type || '').split('/').pop(), amount: e.data.amount || '', approvals: (e.data.approvals || []).length, status: e.data.status || 'draft' }))",
      columns: [['code', 'Request'], ['title', 'Title'], ['type', 'Type'], ['amount', 'Amount', 'end'], ['approvals', 'Approvals', 'end'], ['status', 'Status', undefined, 'badge']], empty: 'You have not asked for anything.' }),
  ]
}
