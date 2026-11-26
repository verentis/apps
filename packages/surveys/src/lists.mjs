// Surveys views from the design: every response.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'responses.page.yaml', id: 'surveys-responses', name: 'Responses', description: 'Every response; open one to read it.', icon: 'message-square-text',
      container: containers.responses.path, mime: mimeTypes.response,
      rows: "RECORDS.map(e => ({ path: e.path, code: e.data.code || e.name, survey: String(e.data.survey || '').split('/').pop(), respondent: e.data.respondentName || e.data.respondentEmail || 'Anonymous', status: e.data.status || 'draft', submitted: e.data.submittedAt || '' })).sort((a, b) => a.submitted < b.submitted ? 1 : -1)",
      columns: [['code', 'Response'], ['survey', 'Survey'], ['respondent', 'Respondent'], ['status', 'Status', undefined, 'badge'], ['submitted', 'Submitted', undefined, 'relative']], empty: 'No responses yet.' }),
  ]
}
