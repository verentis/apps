import { describe, expect, it, vi } from 'vitest'
import { handOver, withAppCalls } from '../../../tools/file-apps/app-calls.mjs'

const apps = result => ({ call: vi.fn(async () => result) })
const unavailable = code => ({ call: vi.fn(async () => { throw Object.assign(new Error('not here'), { code }) }) })
const spec = { app: 'accounting', operation: 'post-journal', field: 'journalRequest', key: 'journal-INV-1', now: 1700000000000 }

describe('hand-overs from a script to another app', () => {
  it('calls the operation once with the request and an attempt key, then records what came back', async () => {
    const client = apps({ result: { path: '/journals/INV-1' } })
    const record = vi.fn(async path => ({ message: 'Issued', path }))
    expect(await handOver(client, { journalRequest: { lines: [] } }, { ...spec, record })).toEqual({ message: 'Issued', path: '/journals/INV-1' })
    expect(client.call).toHaveBeenCalledWith('accounting', 'post-journal', { lines: [] }, { key: 'journal-INV-1-1700000000000' })
    expect(record).toHaveBeenCalledWith('/journals/INV-1')
  })

  it('hands nothing over when the record had nothing to ask for (already done)', async () => {
    const client = apps({})
    const record = vi.fn()
    expect(await handOver(client, { message: 'Already issued' }, { ...spec, record })).toEqual({ message: 'Already issued' })
    expect(client.call).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('skips an optional app that is missing, and refuses a required one with nothing recorded', async () => {
    const record = vi.fn()
    expect(await handOver(unavailable('target_not_installed'), { message: 'Confirmed', invoiceRequest: {} },
      { ...spec, field: 'invoiceRequest', record })).toEqual({ message: 'Confirmed' })
    await expect(handOver(unavailable('operation_not_offered'), { journalRequest: {} }, { ...spec, required: true, label: 'Accounting', record }))
      .rejects.toThrow('Accounting is not available right now, so nothing was done.')
    expect(record).not.toHaveBeenCalled()
  })

  it("passes the other app's failure on, and refuses a result without the value to record", async () => {
    const record = vi.fn()
    const failing = { call: vi.fn(async () => { throw Object.assign(new Error('The period is closed.'), { code: 'operation_failed' }) }) }
    await expect(handOver(failing, { journalRequest: {} }, { ...spec, record })).rejects.toThrow('The period is closed.')
    await expect(handOver(apps({ result: {} }), { journalRequest: {} }, { ...spec, label: 'Accounting', record })).rejects.toThrow('Accounting did not confirm this.')
    expect(record).not.toHaveBeenCalled()
  })

  it('withAppCalls runs the hand-over only for its operations and records with the same parameters', async () => {
    const run = vi.fn(async parameters => parameters.operation === 'issue-invoice'
      ? { journalRequest: { lines: [] }, revision: 'r2' }
      : { message: `ran ${parameters.operation}`, journal: parameters.journal, revision: parameters.revision })
    const runWithApps = withAppCalls(run, { 'issue-invoice': { ...spec, key: 'journal', recordOperation: 'complete-invoice', parameter: 'journal',
      recordParameters: prepared => ({ revision: prepared.revision }) } })
    const client = apps({ result: { path: '/journals/INV-1' } })
    expect(await runWithApps({ operation: 'issue-invoice', path: '/invoices/INV-1', date: '2026-03-01' }, 'files', client))
      .toEqual({ message: 'ran complete-invoice', journal: '/journals/INV-1', revision: 'r2' })
    expect(run).toHaveBeenLastCalledWith({ operation: 'complete-invoice', path: '/invoices/INV-1', date: '2026-03-01', journal: '/journals/INV-1', revision: 'r2' }, 'files', {})
    expect(client.call.mock.calls[0][3].key).toMatch(/^journal-INV-1-\d+$/)
    expect(await runWithApps({ operation: 'save', path: '/invoices/INV-1' }, 'files', client)).toEqual({ message: 'ran save' })
    expect(client.call).toHaveBeenCalledTimes(1)
  })
})
