import { describe, expect, it } from 'vitest'
import { recordPath, starterRecords, templates } from '../src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
const options = { now }
let ids = 0
const record = (kind, values) => ({
  ...templates[kind], id: `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, createdAt: now, updatedAt: now, ...values,
})
const corolla = '/vehicles/VEH-0001' // seeded at 45200 km
const transit = '/vehicles/VEH-0002' // seeded at 88100 km

function fleet(extra = {}) {
  return memoryFiles({
    ...Object.fromEntries(starterRecords.map(item => [recordPath(item), item])),
    ...extra,
  })
}

const service = (values = {}) => record('service', {
  code: 'FSRV-0100', vehicle: transit, date: '2026-03-09', odometerKm: '88500', type: 'repair',
  description: 'Brake pads', cost: '85.00', ...values,
})
const vehicle = (values = {}) => record('vehicle', {
  code: 'VEH-0100', make: 'VW', model: 'Caddy', year: '2023', licensePlate: 'CA 555-111', vin: 'WVWZZZ1KZAW000001',
  driverName: 'Lerato N', status: 'active', odometerKm: '12000', ...values,
})
const post = (files, operation, path) => run({ operation, path }, files, options)

describe('Fleet posting script', () => {
  it('logs a valid draft service, moves the vehicle odometer forward and is idempotent', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service({ odometerKm: '88500.5000' }) })
    expect(await post(files, 'log-service', '/service-logs/FSRV-0100'))
      .toEqual({ message: 'Logged FSRV-0100 at 88500.5 km', path: '/service-logs/FSRV-0100' })
    expect(files.json('/service-logs/FSRV-0100')).toMatchObject({ status: 'done', doneAt: now, odometerKm: '88500.5' })
    expect(files.json(transit)).toMatchObject({ odometerKm: '88500.5', updatedAt: now })
    const writes = files.writes.length
    expect(await post(files, 'log-service', '/service-logs/FSRV-0100')).toMatchObject({ message: 'FSRV-0100 is already done' })
    expect(files.writes.length).toBe(writes)
  })

  it('accepts a reading equal to the current odometer without rewriting the vehicle', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service({ odometerKm: '88100' }) })
    const before = files.json(transit).updatedAt
    await post(files, 'log-service', '/service-logs/FSRV-0100')
    expect(files.json('/service-logs/FSRV-0100')).toMatchObject({ status: 'done', odometerKm: '88100' })
    expect(files.json(transit).updatedAt).toBe(before)
    expect(files.writes).toEqual(['/service-logs/FSRV-0100'])
  })

  it('refuses an odometer regression and leaves the log a draft', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service({ odometerKm: '80000' }) })
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100'))
      .rejects.toThrow(/80000 km is behind VEH-0002's current 88100 km/)
    expect(files.json('/service-logs/FSRV-0100').status).toBe('draft')
    expect(files.json(transit).odometerKm).toBe('88100')
  })

  it.each([
    ['no vehicle', service({ vehicle: '' }), /Choose the vehicle/],
    ['an unknown vehicle', service({ vehicle: '/vehicles/VEH-9999' }), /VEH-9999 does not exist/],
    ['a path outside \/vehicles', service({ vehicle: '/elsewhere/VEH-0001' }), /Choose a vehicle from \/vehicles/],
    ['no odometer reading', service({ odometerKm: '' }), /non-negative decimal/],
    ['no date', service({ date: '' }), /service date \(YYYY-MM-DD\) is required/],
    ['a malformed cost', service({ cost: 'lots' }), /Cost must be a non-negative decimal/],
  ])('refuses to log a service with %s', async (_, value, error) => {
    const files = fleet({ '/service-logs/FSRV-0100': value })
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100')).rejects.toThrow(error)
    expect(files.json('/service-logs/FSRV-0100').status).toBe('draft')
  })

  it('refuses services against retired or archived vehicles and archived logs', async () => {
    const files = fleet({
      '/vehicles/VEH-0100': vehicle({ status: 'retired', retiredAt: now }),
      '/vehicles/VEH-0101': vehicle({ code: 'VEH-0101', state: 'archived', archivedAt: now }),
      '/service-logs/FSRV-0100': service({ vehicle: '/vehicles/VEH-0100', odometerKm: '12500' }),
      '/service-logs/FSRV-0101': service({ code: 'FSRV-0101', vehicle: '/vehicles/VEH-0101', odometerKm: '12500' }),
      '/service-logs/FSRV-0102': service({ code: 'FSRV-0102', state: 'archived', archivedAt: now }),
    })
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100')).rejects.toThrow(/VEH-0100 is retired/)
    await expect(post(files, 'log-service', '/service-logs/FSRV-0101')).rejects.toThrow(/VEH-0101 is archived/)
    await expect(post(files, 'log-service', '/service-logs/FSRV-0102')).rejects.toThrow(/archived. Restore it before logging/)
  })

  it('does not overwrite a log edited while it was being posted', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service() })
    const write = files.write
    files.write = async (path, ...rest) => { files.touch('/service-logs/FSRV-0100'); return write(path, ...rest) }
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100')).rejects.toThrow(/changed while it was being posted/)
  })

  it('completes an interrupted log without applying the reading twice', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service() })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/service-logs/FSRV-0100') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100')).rejects.toThrow('connection lost')
    expect(files.json(transit).odometerKm).toBe('88500')
    files.write = write
    // The retry sees the reading equal to the vehicle's odometer, skips the vehicle and finishes the log.
    expect(await post(files, 'log-service', '/service-logs/FSRV-0100')).toMatchObject({ message: 'Logged FSRV-0100 at 88500 km' })
    expect(files.json('/service-logs/FSRV-0100')).toMatchObject({ status: 'done', doneAt: now })
    expect(files.json(transit).odometerKm).toBe('88500')
  })

  it('retires an active vehicle, locks further services and is idempotent', async () => {
    const files = fleet({ '/service-logs/FSRV-0100': service({ vehicle: corolla, odometerKm: '46000' }) })
    expect(await post(files, 'retire', corolla)).toEqual({ message: 'Retired VEH-0001', path: corolla })
    expect(files.json(corolla)).toMatchObject({ status: 'retired', retiredAt: now, updatedAt: now })
    expect(await post(files, 'retire', corolla)).toEqual({ message: 'VEH-0001 is already retired', path: corolla })
    await expect(post(files, 'log-service', '/service-logs/FSRV-0100')).rejects.toThrow(/VEH-0001 is retired/)
  })

  it('refuses the invalid transitions into retired', async () => {
    const files = fleet({
      '/vehicles/VEH-0100': vehicle({ status: 'in-maintenance' }),
      '/vehicles/VEH-0101': vehicle({ code: 'VEH-0101', state: 'archived', archivedAt: now }),
    })
    await expect(post(files, 'retire', '/vehicles/VEH-0100')).rejects.toThrow(/in maintenance. Set it back to active/)
    expect(files.json('/vehicles/VEH-0100').status).toBe('in-maintenance')
    await expect(post(files, 'retire', '/vehicles/VEH-0101')).rejects.toThrow(/archived. Restore it before retiring/)
  })

  it('only acts on records directly in its containers', async () => {
    await expect(post(fleet(), 'log-service', corolla)).rejects.toThrow(/directly in \/service-logs/)
    await expect(post(fleet(), 'log-service', '/service-logs/a/b')).rejects.toThrow(/directly in \/service-logs/)
    await expect(post(fleet(), 'retire', '/service-logs/FSRV-0001')).rejects.toThrow(/directly in \/vehicles/)
    await expect(post(fleet(), 'retire', '/vehicles/VEH-9999')).rejects.toThrow(/does not exist/)
    await expect(post(fleet(), 'delete', corolla)).rejects.toThrow(/Unsupported operation/)
  })
})
