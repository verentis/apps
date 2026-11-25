// What Legal Matters adds to its launch page: every matter by where it stands, from intake to open, as a board and
// a searchable list. A matter opens beside the page. Status changes stay on the matter form: screening and the
// conflict decision run the workflow script with checks the board cannot make, so the board is read-only.
import { board, section } from '../../../tools/file-apps/canvas.mjs'
import { matters, mime } from './contracts.mjs'

const live = "(data.matters || []).filter(e => e.kind === 'file' && e.data && e.data.state !== 'archived')"
const stages = [{ value: 'intake', label: 'Intake' }, { value: 'screened', label: 'Screened' }, { value: 'open', label: 'Open' }, { value: 'declined', label: 'Declined' }]

export const views = {
  'home.page.yaml': {
    label: 'Matters', icon: 'briefcase-business',
    count: `{{ ${live}.filter(e => e.data.status === 'intake').length }}`,
    access: [{ path: matters, reason: 'List the matters and where each one stands' }],
    data: { matters: { kind: 'folder', path: matters, contents: true, 'mime-pattern': mime } },
    top: [section('Matters', [
      board(`{{ ${live} }}`, 'data.status', stages, { title: 'data.title', code: 'data.code', meta: ['data.disposition', 'data.currency'] }, { emptyText: 'No matters yet' }),
      {
        type: 'canvas.table',
        props: {
          rows: `{{ ${live} }}`, rowKey: 'path', clickable: true, search: true, sortable: true, pageSize: 25, narrow: 'list', emptyText: 'No matters yet',
          facets: ['data.status'],
          columns: [
            { key: 'data.code', label: 'Matter' }, { key: 'data.title', label: 'Title' },
            { key: 'data.status', label: 'Status', format: 'badge', labels: { intake: 'Intake', screened: 'Screened', open: 'Open', declined: 'Declined' } },
            { key: 'data.disposition', label: 'Conflict decision', format: 'badge', labels: { 'undecided': 'Undecided', 'clear': 'Clear', 'waiver-reviewed': 'Waiver reviewed', 'decline': 'Decline' } },
            { key: 'data.reviewBy', label: 'Reviewed by' }, { key: 'data.updatedAt', label: 'Updated', format: 'relative' },
          ],
        },
        on: { 'row-click': [{ 'open-file': { path: '{{ event.path }}', mode: 'edit', open: 'side' } }] },
      },
    ], 'Every matter from intake to open. A matter opens beside this list.')],
  },
}
