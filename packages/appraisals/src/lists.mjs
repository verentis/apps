// Appraisals views from the design: past cycles with their average score.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'cycles.page.yaml', id: 'appraisals-cycles', name: 'Past cycles', description: 'Completed cycles with how many were appraised and the average score.', icon: 'history', container: containers.appraisals.path, mime: mimeTypes.appraisal, clickable: false,
      rows: "RECORDS.filter(e => e.data.status === 'done').map(e => e.data.period || 'No period').filter((p, i, all) => all.indexOf(p) === i).map(p => ({ cycle: p, appraised: RECORDS.filter(e => e.data.status === 'done' && (e.data.period || 'No period') === p).length,"
        + " average: (RECORDS.filter(e => e.data.status === 'done' && (e.data.period || 'No period') === p && e.data.overallScore != null && e.data.overallScore !== '').reduce((sum, e, i, all) => sum + Number(e.data.overallScore) / all.length, 0)).toFixed(2) })).sort((a, b) => a.cycle < b.cycle ? 1 : -1)",
      columns: [['cycle', 'Cycle'], ['appraised', 'Appraised', 'end'], ['average', 'Average score', 'end']], empty: 'No cycle has been completed yet.' }),
  ]
}
