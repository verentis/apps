// Fleet views from the design: the service log across vehicles.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

export function listPages() {
  return [
    listPage({ file: 'services.page.yaml', id: 'fleet-services', name: 'Services', description: 'The service log across every vehicle.', icon: 'wrench', container: containers.services.path, mime: mimeTypes.service,
      rows: "RECORDS.map(e => ({ path: e.path, date: e.data.date, vehicle: String(e.data.vehicle || '').split('/').pop(), type: e.data.type || '', odometer: e.data.odometerKm, cost: e.data.cost || '', status: e.data.status || '' })).sort((a, b) => a.date < b.date ? 1 : -1)",
      columns: [['date', 'Date', undefined, 'date'], ['vehicle', 'Vehicle'], ['type', 'Service'], ['odometer', 'Odometer (km)', 'end'], ['cost', 'Cost', 'end'], ['status', 'Status', undefined, 'badge']], empty: 'No services logged yet.' }),
  ]
}
