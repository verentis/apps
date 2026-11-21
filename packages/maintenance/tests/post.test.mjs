import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { schemas, templates } from '../src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values) => ({ ...templates[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validRequest = ajv.compile(schemas.request)
const validEquipment = ajv.compile(schemas.equipment)

const equipment = (values = {}) => record('equipment', { code: 'EQP-0001', name: 'CNC mill', ...values })
const request = (values = {}) => record('request', { code: 'MREQ-0001', equipment: '/equipment/EQP-0001', scheduledDate: '2026-03-12', ...values })
const started = (values = {}) => request({ stage: 'in-progress', startedAt: now, ...values })

const shop = (extra = {}) => memoryFiles({ '/equipment/EQP-0001': equipment(), ...extra })
const post = (files, operation, path = '/maintenance-requests/MREQ-0001') => run({ operation, path }, files, options)

describe('Maintenance action script', () => {
  it('starts a new request, puts the equipment under maintenance and is idempotent', async () => {
    const files = shop({ '/maintenance-requests/MREQ-0001': request() })
    expect(await post(files, 'start-request'))
      .toEqual({ message: 'Started MREQ-0001 · EQP-0001 under maintenance', path: '/maintenance-requests/MREQ-0001' })
    const saved = files.json('/maintenance-requests/MREQ-0001')
    expect(saved).toMatchObject({ stage: 'in-progress', startedAt: now })
    expect(files.json('/equipment/EQP-0001').status).toBe('under-maintenance')
    expect(validRequest(saved)).toBe(true)
    expect(validRequest.errors ?? []).toEqual([])
    const writes = files.writes.length
    expect(await post(files, 'start-request')).toMatchObject({ message: 'MREQ-0001 is already in-progress' })
    expect(files.writes.length).toBe(writes)
  })

  it('completes an in-progress request, restores the equipment, stamps completedAt and locks', async () => {
    const files = shop({
      '/equipment/EQP-0001': equipment({ status: 'under-maintenance' }),
      '/maintenance-requests/MREQ-0001': started(),
    })
    expect(await post(files, 'complete-request'))
      .toEqual({ message: 'Completed MREQ-0001 · EQP-0001 operational', path: '/maintenance-requests/MREQ-0001' })
    const saved = files.json('/maintenance-requests/MREQ-0001')
    expect(saved).toMatchObject({ stage: 'repaired', startedAt: now, completedAt: now })
    expect(files.json('/equipment/EQP-0001').status).toBe('operational')
    expect(validRequest(saved)).toBe(true)
    expect(validEquipment(files.json('/equipment/EQP-0001'))).toBe(true)
    expect(await post(files, 'complete-request')).toMatchObject({ message: 'MREQ-0001 is already repaired' })
    // Repaired is final.
    await expect(post(files, 'start-request')).rejects.toThrow(/MREQ-0001 is repaired; only new requests/)
    await expect(post(files, 'scrap')).rejects.toThrow(/MREQ-0001 is repaired; only new or in-progress/)
  })

  it.each([
    ['a new', request(), 'EQP-0001'],
    ['an in-progress', started(), 'EQP-0001'],
  ])('scraps %s request together with its equipment, idempotently', async (_, value) => {
    const files = shop({ '/maintenance-requests/MREQ-0001': value })
    expect(await post(files, 'scrap'))
      .toEqual({ message: 'Scrapped MREQ-0001 · EQP-0001 scrapped', path: '/maintenance-requests/MREQ-0001' })
    const saved = files.json('/maintenance-requests/MREQ-0001')
    expect(saved).toMatchObject({ stage: 'scrap', scrappedAt: now })
    expect(files.json('/equipment/EQP-0001').status).toBe('scrapped')
    expect(validRequest(saved)).toBe(true)
    expect(await post(files, 'scrap')).toMatchObject({ message: 'MREQ-0001 is already scrapped' })
    await expect(post(files, 'start-request')).rejects.toThrow(/MREQ-0001 is scrap; only new requests/)
    await expect(post(files, 'complete-request')).rejects.toThrow(/MREQ-0001 is scrap; only in-progress requests/)
  })

  it.each([
    ['start-request', request(), /EQP-0001 is scrapped and cannot be maintained/],
    ['complete-request', started(), /EQP-0001 is scrapped and cannot be repaired/],
  ])('refuses %s against scrapped equipment', async (operation, value, error) => {
    const files = shop({
      '/equipment/EQP-0001': equipment({ status: 'scrapped' }),
      '/maintenance-requests/MREQ-0001': value,
    })
    await expect(post(files, operation)).rejects.toThrow(error)
    expect(files.json('/maintenance-requests/MREQ-0001').stage).toBe(value.stage)
  })

  it('refuses invalid transitions and operations', async () => {
    await expect(post(shop({ '/maintenance-requests/MREQ-0001': request() }), 'complete-request'))
      .rejects.toThrow(/MREQ-0001 is new; only in-progress requests can be completed/)
    await expect(post(shop({ '/maintenance-requests/MREQ-0001': request({ state: 'archived', archivedAt: now }) }), 'start-request'))
      .rejects.toThrow(/archived/)
    await expect(post(shop(), 'start-request', '/elsewhere/MREQ-0001')).rejects.toThrow(/directly in \/maintenance-requests/)
    await expect(post(shop({ '/maintenance-requests/MREQ-0001': request() }), 'delete')).rejects.toThrow(/Unsupported operation/)
  })

  it.each([
    ['no equipment', request({ equipment: '' }), /Choose the equipment/],
    ['unknown equipment', request({ equipment: '/equipment/EQP-9999' }), /EQP-9999 does not exist/],
    ['a path outside the equipment container', request({ equipment: '/elsewhere/EQP-0001' }), /directly in \/equipment/],
    ['a reference to a non-equipment file', request({ equipment: '/equipment/MREQ-0002' }), /is not an equipment/],
  ])('refuses to start a request with %s', async (_, value, error) => {
    const files = shop({
      '/maintenance-requests/MREQ-0001': value,
      '/equipment/MREQ-0002': request({ code: 'MREQ-0002' }),
    })
    await expect(post(files, 'start-request')).rejects.toThrow(error)
    expect(files.json('/maintenance-requests/MREQ-0001').stage).toBe('new')
  })

  it('completes an interrupted start on retry without flipping the equipment twice', async () => {
    const files = shop({ '/maintenance-requests/MREQ-0001': request() })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/maintenance-requests/MREQ-0001') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(post(files, 'start-request')).rejects.toThrow('connection lost')
    expect(files.json('/equipment/EQP-0001').status).toBe('under-maintenance')
    files.write = write
    await post(files, 'start-request')
    expect(files.json('/maintenance-requests/MREQ-0001')).toMatchObject({ stage: 'in-progress', startedAt: now })
    expect(files.writes.filter(path => path === '/equipment/EQP-0001')).toHaveLength(1)
  })

  it.each([
    ['request', '/maintenance-requests/MREQ-0001'],
    ['equipment', '/equipment/EQP-0001'],
  ])('does not overwrite a %s edited while it was being posted', async (_, touched) => {
    const files = shop({ '/maintenance-requests/MREQ-0001': request() })
    const write = files.write
    files.write = async (...args) => { files.touch(touched); return write(...args) }
    await expect(post(files, 'start-request')).rejects.toThrow(/changed while it was being posted/)
  })
})
