import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-06-01T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const event = (values = {}) => ({
  ...templates.event, id: uuid(), createdAt: now, updatedAt: now, code: 'EVT-0001',
  name: 'Launch day', venue: 'Main hall', startsAt: '2026-06-10T09:00:00Z', endsAt: '2026-06-10T17:00:00Z',
  capacity: 10, ticketPrice: '100.00', status: 'published', publishedAt: now, ...values,
})
const registration = (values = {}) => ({
  ...templates.registration, id: uuid(), createdAt: now, updatedAt: now, code: 'EVR-0001',
  event: '/events/EVT-0001', attendeeName: 'Avery Adams', attendeeEmail: 'avery@example.com', qty: 2,
  status: 'draft', ...values,
})
const call = (files, operation, path, extra = {}) => run({ operation, path, ...extra }, files, { now })

describe('Events event actions', () => {
  it('publishes a draft event with a start time, idempotently', async () => {
    const files = memoryFiles({ '/events/EVT-0001': event({ status: 'draft', publishedAt: undefined }) })
    expect(await call(files, 'publish', '/events/EVT-0001')).toEqual({ message: 'Published EVT-0001', path: '/events/EVT-0001' })
    expect(files.json('/events/EVT-0001')).toMatchObject({ status: 'published', publishedAt: now, updatedAt: now })
    expect(await call(files, 'publish', '/events/EVT-0001')).toMatchObject({ message: 'EVT-0001 is already published' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to publish without a start time or from a final status', async () => {
    const files = memoryFiles({
      '/events/EVT-0001': event({ status: 'draft', startsAt: '' }),
      '/events/EVT-0002': event({ code: 'EVT-0002', status: 'done', completedAt: now }),
      '/events/EVT-0003': event({ code: 'EVT-0003', status: 'cancelled', cancelledAt: now }),
    })
    await expect(call(files, 'publish', '/events/EVT-0001')).rejects.toThrow(/Set the start time/)
    await expect(call(files, 'publish', '/events/EVT-0002')).rejects.toThrow(/only draft events can be published/)
    await expect(call(files, 'publish', '/events/EVT-0003')).rejects.toThrow(/only draft events can be published/)
    expect(files.writes).toEqual([])
  })

  it.each([['published'], ['ongoing']])('completes a %s event, idempotently', async status => {
    const files = memoryFiles({ '/events/EVT-0001': event({ status }) })
    expect(await call(files, 'complete', '/events/EVT-0001')).toEqual({ message: 'Completed EVT-0001', path: '/events/EVT-0001' })
    expect(files.json('/events/EVT-0001')).toMatchObject({ status: 'done', completedAt: now })
    expect(await call(files, 'complete', '/events/EVT-0001')).toMatchObject({ message: 'EVT-0001 is already done' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['draft'], ['cancelled']])('refuses to complete a %s event', async status => {
    const files = memoryFiles({ '/events/EVT-0001': event({ status, publishedAt: undefined, cancelledAt: now }) })
    await expect(call(files, 'complete', '/events/EVT-0001')).rejects.toThrow(/can be completed/)
  })

  it('cancels a draft or published event but never a done one, idempotently', async () => {
    const files = memoryFiles({
      '/events/EVT-0001': event({ status: 'draft', publishedAt: undefined }),
      '/events/EVT-0002': event({ code: 'EVT-0002', status: 'done', completedAt: now }),
    })
    expect(await call(files, 'cancel', '/events/EVT-0001')).toEqual({ message: 'Cancelled EVT-0001', path: '/events/EVT-0001' })
    expect(files.json('/events/EVT-0001')).toMatchObject({ status: 'cancelled', cancelledAt: now })
    expect(await call(files, 'cancel', '/events/EVT-0001')).toMatchObject({ message: 'EVT-0001 is already cancelled' })
    await expect(call(files, 'cancel', '/events/EVT-0002')).rejects.toThrow(/events can be cancelled/)
    expect(files.writes).toHaveLength(1)
  })

  it('refuses archived events and anything that is not an event in /events', async () => {
    const files = memoryFiles({
      '/events/EVT-0001': event({ status: 'draft', publishedAt: undefined, state: 'archived', archivedAt: now }),
      '/events/odd': { kind: 'registration' },
    })
    await expect(call(files, 'publish', '/events/EVT-0001')).rejects.toThrow(/is archived/)
    await expect(call(files, 'publish', '/events/odd')).rejects.toThrow(/is not an event/)
    await expect(call(files, 'publish', '/events/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'publish', '/event-registrations/EVR-0001')).rejects.toThrow(/directly in \/events/)
    await expect(call(files, 'promote', '/events/EVT-0001')).rejects.toThrow(/Unsupported operation/)
  })
})

describe('Events registration actions', () => {
  const workspace = (extra = {}) => memoryFiles({
    '/events/EVT-0001': event(),
    '/event-registrations/EVR-0001': registration(),
    ...extra,
  })

  it('confirms a draft registration on a published event, idempotently', async () => {
    const files = workspace()
    expect(await call(files, 'confirm', '/event-registrations/EVR-0001')).toEqual({ message: 'Confirmed EVR-0001', path: '/event-registrations/EVR-0001' })
    expect(files.json('/event-registrations/EVR-0001')).toMatchObject({ status: 'confirmed', confirmedAt: now, updatedAt: now })
    expect(await call(files, 'confirm', '/event-registrations/EVR-0001')).toMatchObject({ message: 'EVR-0001 is already confirmed' })
    expect(files.writes).toHaveLength(1)
  })

  it('confirms a registration that exactly fills the remaining capacity', async () => {
    const files = workspace({
      '/event-registrations/EVR-0002': registration({ code: 'EVR-0002', qty: 5, status: 'confirmed', confirmedAt: now }),
      '/event-registrations/EVR-0003': registration({ code: 'EVR-0003', qty: 3, status: 'attended', confirmedAt: now }),
    })
    expect(await call(files, 'confirm', '/event-registrations/EVR-0001')).toMatchObject({ message: 'Confirmed EVR-0001' })
    expect(files.json('/event-registrations/EVR-0001').status).toBe('confirmed')
  })

  it('refuses a registration that would exceed the remaining capacity, counting attended seats', async () => {
    const files = workspace({
      '/event-registrations/EVR-0002': registration({ code: 'EVR-0002', qty: 5, status: 'confirmed', confirmedAt: now }),
      '/event-registrations/EVR-0003': registration({ code: 'EVR-0003', qty: 4, status: 'attended', confirmedAt: now }),
    })
    await expect(call(files, 'confirm', '/event-registrations/EVR-0001')).rejects.toThrow(/1 of 10 seats left; this registration needs 2/)
    expect(files.json('/event-registrations/EVR-0001').status).toBe('draft')
  })

  it('ignores draft, cancelled and archived registrations when counting seats', async () => {
    const files = workspace({
      '/event-registrations/EVR-0002': registration({ code: 'EVR-0002', qty: 9, status: 'draft' }),
      '/event-registrations/EVR-0003': registration({ code: 'EVR-0003', qty: 9, status: 'cancelled' }),
      '/event-registrations/EVR-0004': registration({ code: 'EVR-0004', qty: 9, status: 'confirmed', confirmedAt: now, state: 'archived', archivedAt: now }),
      '/event-registrations/EVR-0005': registration({ code: 'EVR-0005', qty: 9, status: 'confirmed', confirmedAt: now, event: '/events/EVT-0002' }),
    })
    expect(await call(files, 'confirm', '/event-registrations/EVR-0001')).toMatchObject({ message: 'Confirmed EVR-0001' })
  })

  it.each([['draft', undefined], ['done', now], ['cancelled', undefined]])('refuses to confirm on a %s event', async (status, completedAt) => {
    const files = workspace({ '/events/EVT-0001': event({
      status, publishedAt: status === 'draft' ? undefined : now, completedAt, cancelledAt: status === 'cancelled' ? now : undefined,
    }) })
    await expect(call(files, 'confirm', '/event-registrations/EVR-0001')).rejects.toThrow(/confirmed on published or ongoing events/)
    expect(files.json('/event-registrations/EVR-0001').status).toBe('draft')
  })

  it('refuses to confirm without an event or seats, or a missing event', async () => {
    const files = workspace({
      '/event-registrations/EVR-0002': registration({ code: 'EVR-0002', event: '' }),
      '/event-registrations/EVR-0003': registration({ code: 'EVR-0003', event: '/events/EVT-9999' }),
    })
    await expect(call(files, 'confirm', '/event-registrations/EVR-0002')).rejects.toThrow(/Choose the event/)
    await expect(call(files, 'confirm', '/event-registrations/EVR-0003')).rejects.toThrow(/does not exist/)
  })

  it('checks in a confirmed registration, idempotently, and never a draft one', async () => {
    const files = workspace({ '/event-registrations/EVR-0001': registration({ status: 'confirmed', confirmedAt: now }) })
    expect(await call(files, 'check-in', '/event-registrations/EVR-0001')).toEqual({ message: 'Checked in EVR-0001', path: '/event-registrations/EVR-0001' })
    expect(files.json('/event-registrations/EVR-0001').status).toBe('attended')
    expect(await call(files, 'check-in', '/event-registrations/EVR-0001')).toMatchObject({ message: 'EVR-0001 has already attended' })
    expect(files.writes).toHaveLength(1)
    const draft = workspace()
    await expect(call(draft, 'check-in', '/event-registrations/EVR-0001')).rejects.toThrow(/only confirmed registrations can be checked in/)
  })

  it('cancels draft and confirmed registrations but never attended ones, idempotently', async () => {
    const files = workspace()
    expect(await call(files, 'cancel-registration', '/event-registrations/EVR-0001')).toEqual({ message: 'Cancelled EVR-0001', path: '/event-registrations/EVR-0001' })
    expect(files.json('/event-registrations/EVR-0001').status).toBe('cancelled')
    expect(await call(files, 'cancel-registration', '/event-registrations/EVR-0001')).toMatchObject({ message: 'EVR-0001 is already cancelled' })
    expect(files.writes).toHaveLength(1)
    const attended = workspace({ '/event-registrations/EVR-0001': registration({ status: 'attended', confirmedAt: now }) })
    await expect(call(attended, 'cancel-registration', '/event-registrations/EVR-0001')).rejects.toThrow(/has attended/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'confirm', '/event-registrations/EVR-0001')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/event-registrations/EVR-0001').status).toBe('draft')
  })
})
