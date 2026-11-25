// What Contract Studio adds to its page: every agreement by where it stands.
import { board, section } from '../../../tools/file-apps/canvas.mjs'
import { contracts, root } from '../scripts/draft/model.mjs'

const draftScript = `${root}/scripts/draft`
const issueScript = `${root}/scripts/issue`
// The scripts refuse a stale agreement: each move carries the version the card was drawn from.
const version = { version: '{{ event.row.data.version }}' }

const stages = [{ value: 'draft', label: 'Draft' }, { value: 'in-review', label: 'In review' }, { value: 'approved', label: 'Approved' }, { value: 'issued', label: 'Issued' }]

export const views = {
  'home.page.yaml': {
    label: 'Agreements', icon: 'file-signature',
    count: "{{ (data.agreements || []).filter(e => e.data && e.data.stage !== 'issued').length }}",
    // Dragging a card runs the stage's own step: submit and return from the draft script, approve (asking who
    // reviewed it) and issue from the issue script. Issued agreements stay put. See `movableBoard`.
    moves: {
      container: contracts, script: draftScript, field: 'stage', final: ['issued'],
      run: {
        'in-review': { operation: 'submit', parameters: version },
        draft: { operation: 'return', parameters: version },
        approved: { operation: 'approve', parameters: version, ask: [{ key: 'reviewer', label: 'Reviewed by', type: 'text', required: true }] },
        issued: { script: issueScript, operation: 'issue', parameters: version },
      },
      confirm: { issued: 'The approved snapshot becomes separate client and internal files.' },
    },
    top: [section('Agreements by stage', [board("{{ (data.agreements || []).filter(e => e.kind === 'file' && e.data) }}", 'data.stage', stages,
      { title: 'data.title', code: 'data.code', meta: ['data.jurisdiction'] }, { emptyText: 'No agreements yet' })], 'Open an agreement to edit, review or issue it.')],
  },
}
