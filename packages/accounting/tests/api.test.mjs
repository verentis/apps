import { describe, expect, it } from 'vitest'
import { defaultSettings, starterAccounts, templates } from '../src/contracts.mjs'
import { postJournal, reverse } from '../scripts/api/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const caller = app => ({ caller: { app }, now })

function ledger() {
  const files = memoryFiles({
    '/settings/accounting.json': { ...defaultSettings, baseCurrency: 'ZAR' },
    '/periods/PER-0001': { ...templates.period, id: 'p1', createdAt: now, updatedAt: now, code: 'PER-0001', name: 'March', startDate: '2026-03-01', endDate: '2026-03-31', status: 'open' },
    ...Object.fromEntries(starterAccounts.map(account => [`/chart-of-accounts/${account.code}`, account])),
  })
  const [a, b] = starterAccounts.slice(0, 2).map(account => `/chart-of-accounts/${account.code}`)
  const request = { source: { path: '/invoices/INV-0001', code: 'INV-0001' }, date: '2026-03-05', description: 'Invoice INV-0001',
    currency: 'ZAR', lines: [{ account: a, direction: 'debit', amount: '115' }, { account: b, direction: 'credit', amount: '115.00' }] }
  return { files, request }
}

describe('Accounting API', () => {
  it('posts a balanced journal named after the record, once, and records the app that posted it', async () => {
    const { files, request } = ledger()
    const posted = await postJournal(request, { files, ...caller('invoicing') }, options)
    expect(posted).toMatchObject({ path: '/journals/INV-0001', created: true })
    expect(files.json('/journals/INV-0001')).toMatchObject({ status: 'posted', source: { path: '/invoices/INV-0001' }, postedBy: { app: 'invoicing' },
      lines: [expect.objectContaining({ amount: '115.00' }), expect.objectContaining({ amount: '115.00' })] })
    expect((await postJournal(request, { files, ...caller('invoicing') }, options)).created).toBe(false)
    await expect(postJournal({ ...request, lines: [{ ...request.lines[0], amount: '120' }, { ...request.lines[1], amount: '120' }] },
      { files, ...caller('invoicing') }, options)).rejects.toThrow(/different amounts/)
  })

  it('keeps its own rules: balance, open period, currency', async () => {
    const { files, request } = ledger()
    await expect(postJournal({ ...request, lines: [request.lines[0], { ...request.lines[1], amount: '1' }] }, { files, ...caller('invoicing') }, options)).rejects.toThrow(/do not balance/)
    await expect(postJournal({ ...request, date: '2026-04-02' }, { files, ...caller('invoicing') }, options)).rejects.toThrow(/No accounting period/)
    await expect(postJournal({ ...request, currency: 'XYZ' }, { files, ...caller('invoicing') }, options)).rejects.toThrow(/kept in/)
  })

  it('reverses only journals the calling app posted', async () => {
    const { files, request } = ledger()
    await postJournal(request, { files, ...caller('invoicing') }, options)
    await expect(reverse({ journal: '/journals/INV-0001' }, { files, ...caller('payroll') }, options)).rejects.toThrow(/not posted by payroll/)
    const reversed = await reverse({ journal: '/journals/INV-0001', date: '2026-03-20', reason: 'Wrong customer' }, { files, ...caller('invoicing') }, options)
    expect(reversed.path).toBe('/journals/INV-0001-R')
    expect(files.json('/journals/INV-0001')).toMatchObject({ reversedBy: { path: '/journals/INV-0001-R' } })
  })
})
