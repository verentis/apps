// File-based Fleet record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, fillTemplate, money, optional, optionalDate, pathOrEmpty,
  schemas as schemaKit, text, timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/fleet'
export const schemaBase = 'https://schemas.verentis.io/fleet/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the fleet data.
export const settingsPath = '/settings/fleet.json'

const vendor = kind => `application/vnd.verentis.fleet.${kind}+json`

export const mimeTypes = {
  vehicles: 'application/vnd.verentis.fleet.vehicles',
  contracts: 'application/vnd.verentis.fleet.contracts',
  services: 'application/vnd.verentis.fleet.services',
  vehicle: vendor('vehicle'),
  contract: vendor('contract'),
  service: vendor('service'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  vehicles: { path: '/vehicles', mime: mimeTypes.vehicles, holds: ['vehicle'] },
  contracts: { path: '/fleet-contracts', mime: mimeTypes.contracts, holds: ['contract'] },
  services: { path: '/service-logs', mime: mimeTypes.services, holds: ['service'] },
}

/** Records are named by a generated code (`VEH-0001`) and stored without an extension in their container. */
export const recordKinds = ['vehicle', 'contract', 'service']
export const containerOf = { vehicle: 'vehicles', contract: 'contracts', service: 'services' }

export const codeSettings = {
  vehicle: { key: 'vehicle-code-prefix', default: 'VEH-', label: 'Vehicle code prefix' },
  contract: { key: 'contract-code-prefix', default: 'FCON-', label: 'Fleet contract code prefix' },
  service: { key: 'service-code-prefix', default: 'FSRV-', label: 'Service log code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Fleet')
export { schemaId }

/** Kilometres and costs are exact non-negative decimal strings (`"45200.5"`), never JSON numbers. */
export const kilometres = money
/** A four-digit model year, empty while a draft is incomplete. */
export const modelYear = { type: 'string', pattern: '^([0-9]{4})?$' }

export const vehicleStatuses = ['active', 'in-maintenance', 'retired']
export const contractTypes = ['lease', 'insurance', 'service']
export const contractStatuses = ['active', 'expired', 'cancelled']
export const serviceTypes = ['maintenance', 'repair', 'inspection', 'other']

// Draft records may be incomplete on disk (a generated record opens straight into its form); posting checks them.
export const schemas = {
  vehicle: recordSchema('vehicle', 'vehicle', {
    code,
    make: text,
    model: text,
    year: modelYear,
    licensePlate: optional(32),
    vin: optional(64),
    driverName: optional(200),
    status: { enum: vehicleStatuses },
    odometerKm: kilometres,
    retiredAt: timestamp,
  }, ['code', 'make', 'model', 'year', 'licensePlate', 'vin', 'driverName', 'status', 'odometerKm'], [
    whenStatus(['retired'], ['retiredAt']),
  ]),
  contract: recordSchema('contract', 'contract', {
    code,
    vehicle: pathOrEmpty,
    type: { enum: contractTypes },
    vendor: optional(200),
    startDate: optionalDate,
    endDate: optionalDate,
    monthlyCost: money,
    status: { enum: contractStatuses },
  }, ['code', 'vehicle', 'type', 'vendor', 'startDate', 'endDate', 'monthlyCost', 'status']),
  service: recordSchema('service', 'service log', {
    code,
    vehicle: pathOrEmpty,
    date: optionalDate,
    odometerKm: kilometres,
    type: { enum: serviceTypes },
    description: optional(1000),
    cost: money,
    status: { enum: ['draft', 'done'] },
    doneAt: timestamp,
  }, ['code', 'vehicle', 'date', 'odometerKm', 'type', 'description', 'cost', 'status'], [
    whenStatus(['done'], ['doneAt']),
  ]),
  settings: settingsSchema({
    expiringSoonDays: { type: 'integer', minimum: 1, maximum: 365 },
  }, ['expiringSoonDays']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills empty dates with today.
 */
export const templates = {
  vehicle: recordTemplate('vehicle', {
    make: '{{ name }}', model: '', year: '', licensePlate: '', vin: '', driverName: '',
    status: 'active', odometerKm: '',
  }),
  contract: recordTemplate('contract', {
    vehicle: '', type: 'lease', vendor: '{{ name }}', startDate: '', endDate: '', monthlyCost: '', status: 'active',
  }),
  service: recordTemplate('service', {
    vehicle: '', date: '', odometerKm: '', type: 'maintenance', description: '{{ name }}', cost: '', status: 'draft',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  contract: { startDate: 'today' },
  service: { date: 'today' },
}

const seedTime = '2026-01-01T00:00:00Z'
const seeded = (kind, codeValue, id, fields) => ({
  $schema: schemaId(kind), schemaVersion: 1, kind, id, state: 'active',
  createdAt: seedTime, updatedAt: seedTime, code: codeValue, ...fields,
})

/** Two sample vehicles, a lease contract and two service logs (one done, one draft), seeded once. */
export const starterRecords = [
  seeded('vehicle', 'VEH-0001', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e01', {
    make: 'Toyota', model: 'Corolla', year: '2022', licensePlate: 'CA 123-456', vin: 'JTDBR32E720045671',
    driverName: 'Thandi Mokoena', status: 'active', odometerKm: '45200',
  }),
  seeded('vehicle', 'VEH-0002', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e02', {
    make: 'Ford', model: 'Transit', year: '2021', licensePlate: 'CA 789-012', vin: 'WF0XXXTTGXKY54321',
    driverName: 'Sipho Dlamini', status: 'active', odometerKm: '88100',
  }),
  seeded('contract', 'FCON-0001', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e03', {
    vehicle: '/vehicles/VEH-0001', type: 'lease', vendor: 'AutoLease Co',
    startDate: '2026-01-01', endDate: '2026-12-31', monthlyCost: '650.00', status: 'active',
  }),
  seeded('service', 'FSRV-0001', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e04', {
    vehicle: '/vehicles/VEH-0001', date: '2026-01-15', odometerKm: '45000', type: 'maintenance',
    description: 'Annual service', cost: '120.00', status: 'done', doneAt: seedTime,
  }),
  seeded('service', 'FSRV-0002', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e05', {
    vehicle: '/vehicles/VEH-0002', date: '2026-02-01', odometerKm: '88500', type: 'repair',
    description: 'Brake pads', cost: '85.00', status: 'draft',
  }),
]
export const recordPath = record => `${containers[containerOf[record.kind]].path}/${record.code}`

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, expiringSoonDays: 60,
}

export { fillTemplate }
