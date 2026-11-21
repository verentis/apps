import { describe, expect, it } from 'vitest'
import { defaultSettings, fillTemplate, mimeTypes, templates } from '../src/contracts.mjs'
import { addMinutes, applyTypeSchedule, createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const type = (values = {}) => ({
  ...JSON.parse(fillTemplate(JSON.stringify(templates.type), { id: uuid(), now, name: 'Intro call' })),
  code: 'APT-0001', durationMinutes: 45, host: 'Robin', ...values,
})

const input = (kind, values = {}) => ({
  operation: 'create', creatable: kind, parentPath: kind === 'appointment' ? '/appointments' : '/appointment-types', mime: mimeTypes[kind],
  template: JSON.stringify(templates[kind], null, 2), now, siblings: [], ...values,
})

describe('Appointments create script', () => {
  it('creates an appointment with the next code, today\'s date and the default type', async () => {
    const files = memoryFiles({
      '/settings/appointments.json': { ...defaultSettings, defaultType: '/appointment-types/APT-0001' },
      '/appointment-types/APT-0001': type(),
    })
    const result = await createRecord(input('appointment', { siblings: ['APMT-0007'], name: 'Alex Guest' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/appointments/APMT-0008' })
    expect(files.json('/appointments/APMT-0008')).toMatchObject({
      kind: 'appointment', code: 'APMT-0008', guestName: 'Alex Guest', date: '2026-01-02',
      type: '/appointment-types/APT-0001', host: 'Robin', status: 'booked', id: uuid(),
    })
  })

  it('schedules the end time from the type duration when a start time is given', async () => {
    const files = memoryFiles({ '/appointment-types/APT-0001': type() })
    const record = { kind: 'appointment', type: '/appointment-types/APT-0001', startTime: '09:15', endTime: '', host: '' }
    await applyTypeSchedule(record, files)
    expect(record).toMatchObject({ endTime: '10:00', host: 'Robin' })
  })

  it('leaves the schedule empty without a start time, a type, or past midnight, and keeps a set end time', async () => {
    const files = memoryFiles({ '/appointment-types/APT-0001': type({ durationMinutes: 120 }) })
    const base = { kind: 'appointment', type: '/appointment-types/APT-0001', host: 'Sam' }
    const noStart = { ...base, startTime: '', endTime: '' }
    await applyTypeSchedule(noStart, files)
    expect(noStart.endTime).toBe('')
    const late = { ...base, startTime: '23:30', endTime: '' }
    await applyTypeSchedule(late, files)
    expect(late.endTime).toBe('')
    const set = { ...base, startTime: '09:00', endTime: '09:20' }
    await applyTypeSchedule(set, files)
    expect(set).toMatchObject({ endTime: '09:20', host: 'Sam' })
    const noType = { kind: 'appointment', type: '/appointment-types/missing', startTime: '09:00', endTime: '', host: '' }
    await applyTypeSchedule(noType, files)
    expect(noType.endTime).toBe('')
    expect(addMinutes('09:15', 45)).toBe('10:00')
    expect(addMinutes('23:30', 30)).toBe('')
  })

  it('creates a type with the APT- prefix', async () => {
    const files = memoryFiles({ '/settings/appointments.json': defaultSettings })
    expect(await createRecord(input('type', { name: 'Intro call' }), settings(), files, { uuid })).toEqual({ path: '/appointment-types/APT-0001' })
    expect(files.json('/appointment-types/APT-0001')).toMatchObject({ kind: 'type', name: 'Intro call', durationMinutes: 30, active: true })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('appointment', { parentPath: '/somewhere/else' }), settings(), files, { uuid })
    expect(result).toMatchObject({ name: 'APMT-0001', content: { kind: 'appointment' } })
    expect(files.writes).toEqual([])
  })
})
