// What Spreadsheet BI adds to its generated pages: the dashboard's tiles as big numbers and a chart.
import { chart, repeat, section } from '../../../tools/file-apps/canvas.mjs'

export const views = {
  'viewer.page.yaml': {
    label: 'Dashboard', icon: 'layout-dashboard',
    top: [
      repeat("{{ (data.tilerows || []).filter(t => !t.detail && t.value !== '') }}", [
        { type: 'canvas.dashboard.stat', props: { label: '{{ item.title }}', value: '{{ item.value }}', hint: '{{ item.note }}' } },
      ], { columns: 4, emptyText: 'This dashboard has no single-number tiles' }),
      section('Grouped tiles', [chart("{{ (data.tilerows || []).filter(t => !!t.detail).map(t => ({ label: t.title + ' · ' + t.detail, value: Number(t.value) || 0 })) }}",
        { kind: 'hbar', x: 'label', y: 'value', format: 'number', limit: 20, emptyText: 'No grouped tiles' })]),
    ],
  },
  'snapshots.page.yaml': { label: 'Snapshots', icon: 'camera' },
}
