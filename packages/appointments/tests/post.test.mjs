import { describe, expect, it } from 'vitest'
import { run, applySchedule, findConflict } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const type = (values = {}) => ({
  $schema: 'https://schemas.verentis.io/appointments/v1/type.schema.json', schemaVersion: 1, kind: 'type', state: 'active',
  id: uuid(), createdAt: now, updatedAt: now, code: 'APT-0001', name: 'Intro call',
  durationMinutes: 30, bufferMinutes: 0, host: 'Robin', location: '', active: true, ...values,
})
const appointment = (values = {}) => ({
  ...templates.appointment, id: uuid(), createdAt: now, updatedAt: now, code: 'APMT-0001',
  type: '/appointment-types/APT-0001', guestName: 'Alex Guest', date: '2026-03-12', startTime: '09:00', endTime: '',
  host: '', status: 'booked', ...values,
})
const workspace = (records = {}) => memoryFiles({ '/appointment-types/APT-0001': type(), ...records })
const call = (files, operation, path = '/appointments/APMT-0001') => run({ operation, path }, files, { now })

describe('Appointments actions', () => {
  it('confirms a booked appointment, completing its schedule from the type, idempotently', async () => {
    const files = workspace({ '/appointments/APMT-0001': appointment() })
    expect(await call(files, 'confirm')).toEqual({ message: 'Confirmed APMT-0001 on 2026-03-12 at 09:00', path: '/appointments/APMT-0001' })
    expect(files.json('/appointments/APMT-0001')).toMatchObject({
      status: 'confirmed', endTime: '09:30', host: 'Robin', confirmedAt: now, updatedAt: now,
    })
    expect(await call(files, 'confirm')).toMatchObject({ message: 'APMT-0001 is already confirmed' })
    expect(files.writes).toHaveLength(1)
  })

  it('keeps an explicit end time and host when confirming', async () => {
    const files = workspace({ '/appointments/APMT-0001': appointment({ endTime: '10:30', host: 'Sam' }) })
    await call(files, 'confirm')
    expect(files.json('/appointments/APMT-0001')).toMatchObject({ endTime: '10:30', host: 'Sam' })
    expect(applySchedule({ startTime: '09:00', endTime: '10:30', host: 'Sam' }, type())).toMatchObject({ endTime: '10:30', host: 'Sam' })
  })

  it('requires a date, a start time and a resolvable end time', async () => {
    for (const [values, error] of [
      [{ date: '' }, /needs a date/],
      [{ startTime: '' }, /needs a start time/],
      [{ type: '', endTime: '' }, /needs an end time/],
      [{ type: '', endTime: '08:00' }, /must end after it starts/],
    ]) {
      const files = workspace({ '/appointments/APMT-0001': appointment(values) })
      await expect(call(files, 'confirm')).rejects.toThrow(error)
      expect(files.writes).toEqual([])
    }
  })

  it('rejects confirming an appointment that conflicts with the host\'s calendar', async () => {
    const files = workspace({
      '/appointments/APMT-0001': appointment(),
      '/appointments/APMT-0002': appointment({ code: 'APMT-0002', startTime: '09:15', endTime: '09:45', host: 'Robin', status: 'confirmed', confirmedAt: now }),
    })
    await expect(call(files, 'confirm')).rejects.toThrow(/APMT-0001 conflicts with APMT-0002 \(09:15–09:45\) for Robin on 2026-03-12/)
    expect(files.json('/appointments/APMT-0001').status).toBe('booked')
  })

  it('extends the conflict check by the type\'s buffer, matching hosts case-insensitively', async () => {
    const files = memoryFiles({
      '/appointment-types/APT-0001': type({ bufferMinutes: 15 }),
      '/appointments/APMT-0001': appointment(),
      '/appointments/APMT-0002': appointment({ code: 'APMT-0002', startTime: '09:35', endTime: '10:00', host: ' ROBIN ', status: 'booked' }),
    })
    // 09:00–09:30 with a 15-minute buffer reaches 09:45, into the 09:35 booking.
    await expect(call(files, 'confirm')).rejects.toThrow(/conflicts with APMT-0002/)
    expect(await findConflict(files, { ...appointment({ endTime: '09:30', host: 'robin' }) }, 0)).toBeUndefined()
  })

  it('ignores other dates, other hosts, finished appointments and back-to-back appointments', async () => {
    const files = workspace({
      '/appointments/APMT-0001': appointment(),
      '/appointments/APMT-0002': appointment({ code: 'APMT-0002', date: '2026-03-13', host: 'Robin', endTime: '09:20', status: 'confirmed', confirmedAt: now }),
      '/appointments/APMT-0003': appointment({ code: 'APMT-0003', host: 'Sam', endTime: '09:20', status: 'confirmed', confirmedAt: now }),
      '/appointments/APMT-0004': appointment({ code: 'APMT-0004', host: 'Robin', endTime: '09:20', status: 'cancelled', cancelledAt: now }),
      '/appointments/APMT-0005': appointment({ code: 'APMT-0005', startTime: '09:30', endTime: '10:00', host: 'Robin', status: 'confirmed', confirmedAt: now }),
      '/appointments/APMT-0006': appointment({ code: 'APMT-0006', host: 'Robin', endTime: '09:20', status: 'confirmed', confirmedAt: now, state: 'archived', archivedAt: now }),
    })
    expect(await call(files, 'confirm')).toMatchObject({ message: expect.stringContaining('Confirmed APMT-0001') })
  })

  it('completes a confirmed appointment, idempotently, and refuses booked ones', async () => {
    const files = workspace({ '/appointments/APMT-0001': appointment({ endTime: '09:30', host: 'Robin', status: 'confirmed', confirmedAt: now }) })
    expect(await call(files, 'complete')).toEqual({ message: 'Completed APMT-0001', path: '/appointments/APMT-0001' })
    expect(files.json('/appointments/APMT-0001')).toMatchObject({ status: 'done', completedAt: now })
    expect(await call(files, 'complete')).toMatchObject({ message: 'APMT-0001 is already done' })
    expect(files.writes).toHaveLength(1)
    const booked = workspace({ '/appointments/APMT-0001': appointment() })
    await expect(call(booked, 'complete')).rejects.toThrow(/only confirmed appointments can be completed/)
  })

  it('cancels and marks no-shows from booked or confirmed, idempotently, never from done', async () => {
    const files = workspace({ '/appointments/APMT-0001': appointment() })
    expect(await call(files, 'cancel')).toMatchObject({ message: 'Cancelled APMT-0001' })
    expect(files.json('/appointments/APMT-0001')).toMatchObject({ status: 'cancelled', cancelledAt: now })
    expect(await call(files, 'cancel')).toMatchObject({ message: 'APMT-0001 is already cancelled' })
    await expect(call(files, 'mark-no-show')).rejects.toThrow(/only booked or confirmed appointments can be marked as a no-show/)
    const missed = workspace({ '/appointments/APMT-0001': appointment({ endTime: '09:30', status: 'confirmed', confirmedAt: now }) })
    expect(await call(missed, 'mark-no-show')).toMatchObject({ message: 'Marked APMT-0001 as a no-show' })
    expect(missed.json('/appointments/APMT-0001')).toMatchObject({ status: 'no-show', noShowAt: now })
    expect(await call(missed, 'mark-no-show')).toMatchObject({ message: 'APMT-0001 is already marked as a no-show' })
    const done = workspace({ '/appointments/APMT-0001': appointment({ endTime: '09:30', status: 'done', confirmedAt: now, completedAt: now }) })
    await expect(call(done, 'cancel')).rejects.toThrow(/only booked or confirmed appointments can be cancelled/)
    await expect(call(done, 'confirm')).rejects.toThrow(/only booked appointments can be confirmed/)
  })

  it('refuses archived appointments and anything that is not an appointment in /appointments', async () => {
    const files = workspace({
      '/appointments/APMT-0001': appointment({ state: 'archived', archivedAt: now }),
      '/appointments/odd': { kind: 'type', name: 'Not an appointment' },
    })
    await expect(call(files, 'confirm')).rejects.toThrow(/is archived/)
    await expect(call(files, 'confirm', '/appointments/odd')).rejects.toThrow(/is not an appointment/)
    await expect(call(files, 'confirm', '/appointments/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'confirm', '/appointment-types/APT-0001')).rejects.toThrow(/directly in \/appointments/)
    await expect(call(files, 'publish')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace({ '/appointments/APMT-0001': appointment() })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'confirm')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/appointments/APMT-0001').status).toBe('booked')
  })
})
