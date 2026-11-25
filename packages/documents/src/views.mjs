// What Documents adds to its generated pages: the inbox board.
import { board } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

export const views = {
  'inbox.page.yaml': {
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.cards.path, script: postScriptPath, field: 'status', run: {inbox: 'return-to-inbox', 'in-review': 'send-to-review', validated: 'validate'}, edit: false, final: ['validated'], confirm: {validated: 'Validated documents are stamped and locked; they can only be archived.'} },
    label: 'Inbox', icon: 'inbox', count: "{{ (data.rows || []).filter(r => r.status === 'inbox').length }}",
    top: [board("{{ (data.rows || []).filter(r => r.status !== 'archived-status').map(r => ({ path: r.path, code: r.code, title: r.title, status: r.status, workspace: r.workspace, owner: r.owner, tags: r.tags, filePath: r.filePath, type: r.filePath && r.filePath.includes('.') ? r.filePath.split('.').pop().toUpperCase().slice(0, 5) : 'No file' })) }}", 'status', [{ value: 'inbox', label: 'Inbox' }, { value: 'in-review', label: 'In review' }, { value: 'validated', label: 'Validated' }], { title: 'title', code: 'code', meta: ['workspace', 'owner', 'tags'], badge: 'type' })],
  },
  'library.page.yaml': { label: 'All documents', icon: 'library' },
  'workspaces.page.yaml': { label: 'Workspaces', icon: 'folders' },
}
