// What Quality adds to its generated pages: pass rate and recent results.
import { chart, section } from '../../../tools/file-apps/canvas.mjs'
import { containers } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const decided = "(data.checkrows || []).filter(c => c.result === 'pass' || c.result === 'fail')"

export const views = {
  'home.page.yaml': {
    top: [section('Checks by result', [chart("{{ ['pending', 'pass', 'fail'].map(result => ({ label: result, value: (data.checkrows || []).filter(c => c.result === result).length })) }}",
      { kind: 'strip', x: 'label', y: 'value', labels: { pending: 'Pending', pass: 'Passed', fail: 'Failed' }, palette: { pending: 'muted', pass: 'success', fail: 'danger' }, format: 'integer', emptyText: 'No checks yet' })])],
  },
  'checks.page.yaml': {
    label: 'Checks', icon: 'clipboard-check', count: "{{ (data.checkrows || []).filter(c => c.result === 'pending').length }}",
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.checks.path, script: postScriptPath, field: 'result', run: {pass: {operation: 'record-check', parameters: {result: 'pass'}}, fail: {operation: 'record-check', parameters: {result: 'fail'}}}, edit: false, final: ['pass', 'fail'], confirm: {fail: 'A failed check raises a quality alert.'} },
  },
  'alerts.page.yaml': {
    label: 'Alerts', icon: 'triangle-alert', count: "{{ (data.alertrows || []).filter(a => a.stage !== 'resolved').length }}", tone: 'danger',
    // Dragging a card: see `movableBoard` in tools/file-apps/canvas.mjs.
    moves: { container: containers.alerts.path, script: postScriptPath, field: 'stage', run: {resolved: 'resolve-alert'}, edit: true, final: ['resolved'] },
  },
  'points.page.yaml': {
    label: 'Control points', icon: 'crosshair',
    top: [section('Pass rate per control point', [chart(`{{ ${decided}.map(c => c.point || 'No point').filter((name, index, all) => all.indexOf(name) === index).map(name => ({ label: name, pass: ${decided}.filter(c => (c.point || 'No point') === name && c.result === 'pass').length, fail: ${decided}.filter(c => (c.point || 'No point') === name && c.result === 'fail').length })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['pass', 'fail'], labels: { pass: 'Passed', fail: 'Failed' }, palette: { pass: 'success', fail: 'danger' }, format: 'integer' })])],
  },
}
