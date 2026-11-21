import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecord } from '../scripts/create/main.mjs'
import { defaultSettings } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-06-01T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const template = kind => readFileSync(new URL(`../templates/${kind}.json`, import.meta.url), 'utf8')

const workspace = (extra = {}) => memoryFiles({
  '/settings/events.json': { ...defaultSettings, defaultVenue: 'Main hall' },
  ...extra,
})

const input = (kind, extra = {}) => ({
  operation: 'create', creatable: kind, mime: `application/vnd.verentis.events.${kind}+json`,
  parentPath: kind === 'event' ? '/events' : '/event-registrations', template: template(kind), now, name: 'Example', siblings: [], ...extra,
})

describe('Events create script', () => {
  it('creates an event with the default venue from the settings', async () => {
    const files = workspace()
    const result = await createRecord(input('event'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/events/EVT-0001' })
    expect(files.json('/events/EVT-0001')).toMatchObject({
      kind: 'event', code: 'EVT-0001', name: 'Example', venue: 'Main hall', status: 'draft', capacity: 50, ticketPrice: '',
    })
  })

  it('creates a draft registration with one seat', async () => {
    const files = workspace()
    const result = await createRecord(input('registration'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/event-registrations/EVR-0001' })
    expect(files.json('/event-registrations/EVR-0001')).toMatchObject({
      kind: 'registration', code: 'EVR-0001', attendeeName: 'Example', event: '', qty: 1, status: 'draft',
    })
  })

  it('moves on to the next code when the name is taken', async () => {
    const files = workspace()
    await createRecord(input('event'), undefined, files, { uuid })
    const result = await createRecord(input('event'), undefined, files, { uuid })
    expect(result).toEqual({ path: '/events/EVT-0002' })
  })

  it('returns a proposal outside its writable containers', async () => {
    const files = workspace()
    const proposal = await createRecord(input('event', { parentPath: '/elsewhere' }), undefined, files, { uuid })
    expect(proposal.name).toBe('EVT-0001')
    expect(proposal.content.venue).toBe('Main hall')
    expect(files.writes).toEqual([])
  })

  it('rejects unknown record types', async () => {
    await expect(createRecord(input('event', { creatable: 'ticket' }), undefined, workspace(), { uuid }))
      .rejects.toThrow(/Unknown Events record type/)
  })
})
