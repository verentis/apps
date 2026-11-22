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
const validAlert = ajv.compile(schemas.alert)
const validCheck = ajv.compile(schemas.check)

const point = (values = {}) => record('point', { code: 'QCP-0001', title: 'Weld seam', reference: 'Desk frame', ...values })
const measurePoint = (values = {}) => point({ checkType: 'measure', measureTarget: '12.5', toleranceMin: '12', toleranceMax: '13', ...values })
const check = (values = {}) => record('check', { code: 'QCK-0001', point: '/quality-control-points/QCP-0001', date: '2026-03-10', reference: 'MO-0001', ...values })
const alert = (values = {}) => record('alert', { code: 'QAL-0001', title: 'Scratches', stage: 'investigation', rootCause: 'Worn tool', correctiveAction: 'Replaced the tool', ...values })

const lab = (extra = {}) => memoryFiles({ '/quality-control-points/QCP-0001': point(), ...extra })
const post = (files, parameters, path = '/quality-checks/QCK-0001') => run({ path, ...parameters }, files, options)
const recordCheck = (files, result, path) => post(files, { operation: 'record-check', result }, path)
const resolve = (files, path = '/quality-alerts/QAL-0001') => post(files, { operation: 'resolve-alert' }, path)

describe('Quality action script', () => {
  it('records a pending pass-fail check as pass, idempotently, without raising an alert', async () => {
    const files = lab({ '/quality-checks/QCK-0001': check() })
    expect(await recordCheck(files, 'pass')).toEqual({ message: 'Recorded pass for QCK-0001', path: '/quality-checks/QCK-0001' })
    const saved = files.json('/quality-checks/QCK-0001')
    expect(saved).toMatchObject({ result: 'pass', checkedAt: now })
    expect(saved.alert).toBeUndefined()
    expect([...files.nodes.keys()].some(path => path.startsWith('/quality-alerts/'))).toBe(false)
    expect(await recordCheck(files, 'fail')).toMatchObject({ message: 'QCK-0001 is already recorded as pass' })
  })

  it('records a fail and raises the linked alert create-only, validating against the packaged schemas', async () => {
    const files = lab({ '/quality-checks/QCK-0001': check() })
    expect(await recordCheck(files, 'fail'))
      .toEqual({ message: 'Recorded fail for QCK-0001 and raised alert QCK-0001-AL', path: '/quality-checks/QCK-0001' })
    const saved = files.json('/quality-checks/QCK-0001')
    expect(saved).toMatchObject({ result: 'fail', checkedAt: now, alert: '/quality-alerts/QCK-0001-AL' })
    expect(files.nodes.get('/quality-alerts/QCK-0001-AL').contentType).toBe('application/vnd.verentis.quality.alert+json')
    const raised = files.json('/quality-alerts/QCK-0001-AL')
    expect(raised).toMatchObject({
      kind: 'alert', code: 'QCK-0001-AL', title: 'Failed check QCK-0001 · Weld seam',
      sourceCheck: '/quality-checks/QCK-0001', severity: 'high', stage: 'new',
    })
    expect(validAlert(raised)).toBe(true)
    expect(validAlert.errors ?? []).toEqual([])
    expect(validCheck(saved)).toBe(true)
    // Idempotent: a second run reports instead of raising again.
    const writes = files.writes.length
    expect(await recordCheck(files, 'fail')).toMatchObject({ message: 'QCK-0001 is already recorded as fail' })
    expect(files.writes.length).toBe(writes)
  })

  it.each([
    ['at the minimum', '12', 'pass'],
    ['at the maximum', '13', 'pass'],
    ['inside', '12.5', 'pass'],
    ['just below the minimum', '11.9999', 'fail'],
    ['just above the maximum', '13.0001', 'fail'],
  ])('judges a measured value %s the tolerance as %s', async (_, measuredValue, outcome) => {
    const files = lab({
      '/quality-control-points/QCP-0001': measurePoint(),
      '/quality-checks/QCK-0001': check({ measuredValue }),
    })
    expect(await recordCheck(files, outcome)).toMatchObject({ message: expect.stringContaining(`Recorded ${outcome}`) })
    expect(files.json('/quality-checks/QCK-0001').result).toBe(outcome)
  })

  it('refuses a result that contradicts the tolerance', async () => {
    const files = lab({
      '/quality-control-points/QCP-0001': measurePoint(),
      '/quality-checks/QCK-0001': check({ measuredValue: '14' }),
    })
    await expect(recordCheck(files, 'pass')).rejects.toThrow(/Measured value 14 is outside tolerance \(min 12, max 13\); record fail instead/)
    const within = lab({
      '/quality-control-points/QCP-0001': measurePoint(),
      '/quality-checks/QCK-0001': check({ measuredValue: '12.5' }),
    })
    await expect(recordCheck(within, 'fail')).rejects.toThrow(/within tolerance .*; record pass instead/)
    expect(within.json('/quality-checks/QCK-0001').result).toBe('pending')
  })

  it('honours a one-sided tolerance and requires at least one bound', async () => {
    const minOnly = lab({
      '/quality-control-points/QCP-0001': measurePoint({ toleranceMax: '' }),
      '/quality-checks/QCK-0001': check({ measuredValue: '99' }),
    })
    await expect(recordCheck(minOnly, 'pass')).resolves.toMatchObject({ message: expect.stringContaining('Recorded pass') })
    const unbounded = lab({
      '/quality-control-points/QCP-0001': measurePoint({ toleranceMin: '', toleranceMax: '' }),
      '/quality-checks/QCK-0001': check({ measuredValue: '12.5' }),
    })
    await expect(recordCheck(unbounded, 'pass')).rejects.toThrow(/QCP-0001 has no tolerance/)
  })

  it.each([
    ['no measured value', check({ measuredValue: '' }), /Enter the measured value/],
    ['a non-decimal measured value', check({ measuredValue: 'abc' }), /non-negative decimal/],
  ])('refuses to record a measure check with %s', async (_, value, error) => {
    const files = lab({ '/quality-control-points/QCP-0001': measurePoint(), '/quality-checks/QCK-0001': value })
    await expect(recordCheck(files, 'pass')).rejects.toThrow(error)
    expect(files.json('/quality-checks/QCK-0001').result).toBe('pending')
  })

  it.each([
    ['no control point', check({ point: '' }), /Choose a control point/],
    ['an unknown control point', check({ point: '/quality-control-points/QCP-9999' }), /QCP-9999 does not exist/],
    ['a path outside the points container', check({ point: '/elsewhere/QCP-0001' }), /directly in \/quality-control-points/],
  ])('refuses to record a check with %s', async (_, value, error) => {
    const files = lab({ '/quality-checks/QCK-0001': value })
    await expect(recordCheck(files, 'pass')).rejects.toThrow(error)
    expect(files.json('/quality-checks/QCK-0001').result).toBe('pending')
  })

  it.each([
    ['inactive', point({ active: false }), /QCP-0001 is inactive/],
    ['archived', point({ state: 'archived', archivedAt: now }), /QCP-0001 is archived/],
  ])('refuses to record against an %s control point', async (_, value, error) => {
    const files = lab({ '/quality-control-points/QCP-0001': value, '/quality-checks/QCK-0001': check() })
    await expect(recordCheck(files, 'pass')).rejects.toThrow(error)
  })

  it('enforces the transitions and operations', async () => {
    const files = lab({ '/quality-checks/QCK-0001': check({ state: 'archived', archivedAt: now }) })
    await expect(recordCheck(files, 'pass')).rejects.toThrow(/archived/)
    await expect(recordCheck(lab({ '/quality-checks/QCK-0001': check() }), 'maybe')).rejects.toThrow(/Choose pass or fail/)
    await expect(recordCheck(lab(), 'pass', '/elsewhere/QCK-0001')).rejects.toThrow(/directly in \/quality-checks/)
    await expect(post(lab(), { operation: 'delete' })).rejects.toThrow(/Unsupported operation/)
  })

  it('refuses an alert name taken by something else', async () => {
    const files = lab({
      '/quality-checks/QCK-0001': check(),
      '/quality-alerts/QCK-0001-AL': alert({ code: 'QCK-0001-AL', sourceCheck: '/quality-checks/QCK-0099' }),
    })
    await expect(recordCheck(files, 'fail')).rejects.toThrow(/belongs to something else/)
    expect(files.json('/quality-checks/QCK-0001').result).toBe('pending')
  })

  it('completes an interrupted recording without raising a second alert', async () => {
    const files = lab({ '/quality-checks/QCK-0001': check() })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/quality-checks/QCK-0001') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(recordCheck(files, 'fail')).rejects.toThrow('connection lost')
    files.write = write
    await recordCheck(files, 'fail')
    expect(files.json('/quality-checks/QCK-0001')).toMatchObject({ result: 'fail', alert: '/quality-alerts/QCK-0001-AL' })
    expect(files.writes.filter(path => path === '/quality-alerts/QCK-0001-AL')).toHaveLength(1)
  })

  it('does not overwrite a check edited while it was being recorded', async () => {
    const files = lab({ '/quality-checks/QCK-0001': check() })
    const write = files.write
    files.write = async (...args) => { files.touch('/quality-checks/QCK-0001'); return write(...args) }
    await expect(recordCheck(files, 'pass')).rejects.toThrow(/changed while it was being posted/)
  })

  it('resolves an investigated alert with its analysis, idempotently, and locks the stage', async () => {
    const files = memoryFiles({ '/quality-alerts/QAL-0001': alert() })
    expect(await resolve(files)).toEqual({ message: 'Resolved QAL-0001', path: '/quality-alerts/QAL-0001' })
    const saved = files.json('/quality-alerts/QAL-0001')
    expect(saved).toMatchObject({ stage: 'resolved', resolvedAt: now, rootCause: 'Worn tool', correctiveAction: 'Replaced the tool' })
    expect(validAlert(saved)).toBe(true)
    expect(await resolve(files)).toMatchObject({ message: 'QAL-0001 is already resolved' })
  })

  it.each([
    ['a new alert', alert({ stage: 'new' }), /QAL-0001 is new; only investigation or action alerts/],
    ['no root cause', alert({ rootCause: '  ' }), /Enter the root cause/],
    ['no corrective action', alert({ correctiveAction: '' }), /Enter the corrective action/],
    ['an archived alert', alert({ state: 'archived', archivedAt: now }), /archived/],
  ])('refuses to resolve %s', async (_, value, error) => {
    const files = memoryFiles({ '/quality-alerts/QAL-0001': value })
    await expect(resolve(files)).rejects.toThrow(error)
    expect(files.json('/quality-alerts/QAL-0001').stage).toBe(value.stage)
  })

  it('does not overwrite an alert edited while it was being resolved', async () => {
    const files = memoryFiles({ '/quality-alerts/QAL-0001': alert() })
    const write = files.write
    files.write = async (...args) => { files.touch('/quality-alerts/QAL-0001'); return write(...args) }
    await expect(resolve(files)).rejects.toThrow(/changed while it was being posted/)
  })
})
