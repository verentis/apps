// Referrals views from the design: my referrals.
import { listPage, mine } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    // Theirs: linked to their Employees record (by work email), or carrying their name.
    listPage({ file: 'mine.page.yaml', id: 'referrals-mine', name: 'My referrals', description: 'The people you referred, where each stands, and the points earned.', icon: 'user',
      container: containers.referrals.path, mime: mimeTypes.referral, me: true,
      top: [{ type: 'canvas.dashboard.stat', props: { label: 'Points earned', value: "{{ RECORDS.filter(e => " + mine('referrerName', 'referrerRef') + ").reduce((sum, e) => sum + (Number(e.data.points) || 0), 0) }}" } }],
      rows: "RECORDS.filter(e => " + mine('referrerName', 'referrerRef') + ").map(e => ({ path: e.path, candidate: e.data.candidateName || '', job: String(e.data.job || '').split('/').pop(), status: e.data.status || 'submitted', points: e.data.points || 0 }))",
      columns: [['candidate', 'Candidate'], ['job', 'Job'], ['status', 'Status', undefined, 'badge'], ['points', 'Points', 'end']], empty: 'You have not referred anyone yet.' }),
  ]
}
