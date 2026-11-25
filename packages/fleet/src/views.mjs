// What Fleet adds to its generated pages: contracts on a time strip and monthly cost per vehicle.
import { chart, section, timeStrip } from '../../../tools/file-apps/canvas.mjs'

export const views = {
  'home.page.yaml': { label: 'Vehicles', icon: 'car' },
  'contracts.page.yaml': {
    label: 'Contracts', icon: 'file-signature', count: '{{ (data.expiring || []).length }}', tone: 'warning',
    top: [section('Contracts ending', [timeStrip("{{ (data.rows || []).filter(c => c.status === 'active' && !!c.endDate).map(c => ({ path: c.path, title: [c.vehicle, c.type].filter(part => part).join(' · '), at: c.endDate })) }}",
      { at: 'at', title: 'title', window: { from: '-30d', to: '180d' }, soon: '60d' })], 'Active contracts by end date over the next six months.')],
  },
  'costs.page.yaml': {
    label: 'Costs', icon: 'chart-column',
    bottom: [section('Monthly cost per vehicle', [chart("{{ (data.costs || []).map(v => ({ path: v.path, label: v.licensePlate || v.vehicle || v.code, contracts: (v.monthlyUnits || 0) / 100, services: (v.serviceUnits || 0) / 100 })) }}",
      { kind: 'stacked-hbar', x: 'label', y: ['contracts', 'services'], labels: { contracts: 'Contracts per month', services: 'Service spend' }, format: 'number', decimals: 2 })])],
  },
}
