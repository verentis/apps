import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { nextCode, propose, stamp } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'

const now = '2026-01-02T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })

function input(creatable, values = {}) {
  return {
    operation: 'create',
    creatable,
    parentPath: '/customers',
    template: JSON.stringify(templates[creatable], null, 2),
    now,
    siblings: [],
    ...values,
  }
}

describe('CRM create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('CUST-', 4, [])).toBe('CUST-0001')
    expect(nextCode('CUST-', 4, ['CUST-0002', 'CUST-0010', 'CUST-x', 'DEAL-0099', 'notes'])).toBe('CUST-0011')
    expect(nextCode('A.B', 2, ['A.B07', 'AxB99'])).toBe('A.B08')
  })

  it('accepts who is creating and fills {{ user }} with their name', () => {
    const template = JSON.stringify({ ...templates.deal, owner: '{{ user }}' })
    const result = propose(input('deal', { template, user: { id: 'u-1', name: 'Thandi "T" Mokoena' } }), settings(), uuid)
    expect(result.content.owner).toBe('Thandi "T" Mokoena')
    expect(propose(input('deal', { template, user: null }), settings(), uuid).content.owner).toBe('')
  })

  it('formats sortable UTC stamps', () => {
    expect(stamp(now)).toBe('20260102-093005')
    expect(() => stamp('later')).toThrow()
  })

  it('names records by the next code from the app settings', () => {
    const result = propose(input('company', { siblings: ['CUST-0041'], name: 'Acme' }), settings(), uuid)
    expect(result.name).toBe('CUST-0042')
    expect(result.content).toMatchObject({ kind: 'company', code: 'CUST-0042', name: 'Acme', id: uuid() })

    const deal = propose(input('deal', { parentPath: '/deals' }), settings({ 'deal-code-prefix': 'OPP', 'code-digits': '6' }), uuid)
    expect(deal.name).toBe('OPP000001')
  })

  it('rejects unsafe code prefixes', () => {
    expect(() => propose(input('company'), settings({ 'customer-code-prefix': '../' }), uuid)).toThrow(/code prefix/)
  })

  it('files communications and notes beneath the record they are about', () => {
    const email = propose(input('email', { parentPath: '/customers/CUST-0001' }), settings(), uuid)
    expect(email.name).toBe('activities/20260102-093005-email.json')
    expect(email.content.regarding).toEqual({ path: '/customers/CUST-0001' })

    const note = propose(input('note', { parentPath: '/customers/CUST-0001/notes/' }), settings(), uuid)
    expect(note.name).toBe('20260102-093005-note.json')
    expect(note.content.regarding).toEqual({ path: '/customers/CUST-0001' })
  })

  it('adds a random suffix when retrying a taken name', () => {
    const task = propose(input('task', { parentPath: '/deals/DEAL-0001', attempt: 2 }), settings(), uuid)
    expect(task.name).toBe('activities/20260102-093005-task-abcd.json')
  })

  it('rejects invalid input', () => {
    expect(() => propose(null, settings())).toThrow()
    expect(() => propose({ ...input('company'), extra: true }, settings())).toThrow(/Invalid/)
    expect(() => propose(input('company', { operation: 'delete' }), settings())).toThrow(/operation/)
    expect(() => propose(input('invoice'), settings())).toThrow(/Unknown/)
    expect(() => propose(input('company', { parentPath: 'customers' }), settings())).toThrow(/parent/)
    expect(() => propose(input('company', { template: JSON.stringify(templates.deal) }), settings())).toThrow(/company/)
  })
})

describe('CRM create script writes', () => {
  const failure = statusCode => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
  const filesClient = (...outcomes) => {
    const calls = []
    return { calls, write: async (path, content, options) => {
      calls.push({ path, content: JSON.parse(content), options })
      const outcome = outcomes.shift()
      if (outcome) throw failure(outcome)
      return {}
    } }
  }

  it('creates the record create-only and returns its path, moving on to the next code when taken', async () => {
    const files = filesClient(412)
    const result = await createRecord(input('company', { siblings: ['CUST-0001'], mime: 'application/vnd.crm+json', branch: 'main' }),
      settings(), files, { uuid })
    expect(result).toEqual({ path: '/customers/CUST-0003' })
    expect(files.calls.map(call => call.path)).toEqual(['/customers/CUST-0002', '/customers/CUST-0003'])
    expect(files.calls[1].options).toEqual({ contentType: 'application/vnd.crm+json', ifNoneMatch: '*' })
    expect(files.calls[1].content).toMatchObject({ kind: 'company', code: 'CUST-0003' })
  })

  it('creates communications in the record\'s child folder', async () => {
    const files = filesClient()
    const result = await createRecord(input('email', { parentPath: '/deals/DEAL-0001/' }), settings(), files, { uuid })
    expect(result).toEqual({ path: '/deals/DEAL-0001/activities/20260102-093005-email.json' })
  })

  it('proposes instead of writing outside its grants, on another branch, or without write access', async () => {
    const outside = filesClient()
    expect(await createRecord(input('company', { parentPath: '/clients' }), settings(), outside, { uuid }))
      .toMatchObject({ name: 'CUST-0001' })
    expect(await createRecord(input('company', { parentPath: '/customers-old' }), settings(), outside, { uuid }))
      .toMatchObject({ name: 'CUST-0001' })
    expect(await createRecord(input('company', { branch: 'draft' }), settings(), outside, { branch: 'main', uuid }))
      .toMatchObject({ name: 'CUST-0001' })
    expect(outside.calls).toEqual([])
    expect(await createRecord(input('company'), settings(), filesClient(403), { uuid })).toMatchObject({ name: 'CUST-0001' })
  })

  it('gives up after a bounded number of taken names and surfaces other failures', async () => {
    await expect(createRecord(input('company'), settings(), filesClient(412, 412, 412, 412, 412), { uuid })).rejects.toThrow(/412/)
    await expect(createRecord(input('company'), settings(), filesClient(500), { uuid })).rejects.toThrow(/500/)
  })
})
