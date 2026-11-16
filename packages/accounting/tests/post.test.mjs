import { describe, expect, it } from 'vitest'
import { defaultSettings, starterAccounts, templates } from '../src/contracts.mjs'
import { run } from '../scripts/post/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values) => ({ ...templates[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })
const account = code => `/chart-of-accounts/${code}`

function ledger(extra = {}) {
  return memoryFiles({
    '/settings/accounting.json': { ...defaultSettings, baseCurrency: 'ZAR' },
    ...Object.fromEntries(starterAccounts.map(item => [account(item.code), item])),
    '/periods/PER-0001': record('period', { code: 'PER-0001', name: 'March', startDate: '2026-03-01', endDate: '2026-03-31', status: 'open' }),
    '/periods/PER-0002': record('period', { code: 'PER-0002', name: 'February', startDate: '2026-02-01', endDate: '2026-02-28', status: 'closed', closedAt: now }),
    ...extra,
  })
}

const journal = (values = {}) => record('journal', {
  code: 'JRN-0001', description: 'Capital', date: '2026-03-02', currency: 'ZAR',
  lines: [{ account: account('ACC-0001'), direction: 'debit', amount: '1000' }, { account: account('ACC-0004'), direction: 'credit', amount: '1000.00' }],
  ...values,
})
const expense = (values = {}) => record('expense', {
  code: 'EXP-0001', description: 'Stationery', payee: 'Paper Co', date: '2026-03-05', currency: 'ZAR',
  netAmount: '100', taxAmount: '15', taxCode: 'VAT', expenseAccount: account('ACC-0006'), paymentAccount: account('ACC-0001'), ...values,
})
const post = (files, operation, path, extra = {}) => run({ operation, path, ...extra }, files, options)

describe('Accounting posting script', () => {
  it('posts a balanced draft journal into its open period and normalises amounts', async () => {
    const files = ledger({ '/journals/JRN-0001': journal() })
    expect(await post(files, 'post-journal', '/journals/JRN-0001')).toEqual({ message: 'Posted JRN-0001', path: '/journals/JRN-0001' })
    expect(files.json('/journals/JRN-0001')).toMatchObject({
      status: 'posted', postedAt: now, period: { path: '/periods/PER-0001' }, lines: [{ amount: '1000.00' }, { amount: '1000.00' }],
    })
    expect(await post(files, 'post-journal', '/journals/JRN-0001')).toMatchObject({ message: 'JRN-0001 is already posted' })
  })

  it.each([
    ['unbalanced lines', journal({ lines: [{ account: account('ACC-0001'), direction: 'debit', amount: '10' }, { account: account('ACC-0004'), direction: 'credit', amount: '9.99' }] }), /do not balance/],
    ['a closed period', journal({ date: '2026-02-10' }), /February\) is closed/],
    ['no period', journal({ date: '2025-12-31' }), /No accounting period covers/],
    ['a foreign currency', journal({ currency: 'USD' }), /kept in ZAR/],
    ['an unknown account', journal({ lines: [{ account: account('ACC-9999'), direction: 'debit', amount: '1' }, { account: account('ACC-0004'), direction: 'credit', amount: '1' }] }), /ACC-9999 does not exist/],
    ['too many decimals', journal({ lines: [{ account: account('ACC-0001'), direction: 'debit', amount: '1.001' }, { account: account('ACC-0004'), direction: 'credit', amount: '1.001' }] }), /more than 2 decimal places/],
  ])('refuses to post a journal with %s', async (_, value, error) => {
    const files = ledger({ '/journals/JRN-0001': value })
    await expect(post(files, 'post-journal', '/journals/JRN-0001')).rejects.toThrow(error)
    expect(files.json('/journals/JRN-0001').status).toBe('draft')
  })

  it('does not overwrite a journal edited while it was being posted', async () => {
    const files = ledger({ '/journals/JRN-0001': journal() })
    const write = files.write
    files.write = async (...args) => { files.touch('/journals/JRN-0001'); return write(...args) }
    await expect(post(files, 'post-journal', '/journals/JRN-0001')).rejects.toThrow(/changed while it was being posted/)
  })

  it('reverses a posted journal once, into the period of the reversal date', async () => {
    const files = ledger({ '/journals/JRN-0001': journal() })
    await post(files, 'post-journal', '/journals/JRN-0001')
    const result = await post(files, 'reverse-journal', '/journals/JRN-0001', { date: '2026-03-20', reason: ' Duplicate ' })
    expect(result).toEqual({ message: 'Reversed JRN-0001 with JRN-0001-R', path: '/journals/JRN-0001-R' })
    expect(files.json('/journals/JRN-0001-R')).toMatchObject({
      status: 'posted', date: '2026-03-20', description: 'Reversal of JRN-0001: Duplicate', reversalOf: { path: '/journals/JRN-0001' },
      lines: [{ direction: 'credit', amount: '1000.00' }, { direction: 'debit', amount: '1000.00' }],
    })
    expect(files.json('/journals/JRN-0001')).toMatchObject({ reversedBy: { path: '/journals/JRN-0001-R' }, reversedAt: now })
    expect(await post(files, 'reverse-journal', '/journals/JRN-0001')).toMatchObject({ message: 'JRN-0001 is already reversed by JRN-0001-R' })
    await expect(post(files, 'reverse-journal', '/journals/JRN-0001-R')).rejects.toThrow(/itself a reversal/)
  })

  it('posts an expense as a journal with its tax recovered on the tax code\'s account', async () => {
    const files = ledger({ '/expenses/EXP-0001': expense() })
    expect(await post(files, 'post-expense', '/expenses/EXP-0001')).toEqual({ message: 'Posted EXP-0001 as EXP-0001', path: '/journals/EXP-0001' })
    expect(files.json('/journals/EXP-0001')).toMatchObject({
      status: 'posted', description: 'Stationery · Paper Co', source: { path: '/expenses/EXP-0001' }, period: { path: '/periods/PER-0001' },
      lines: [
        { account: account('ACC-0006'), direction: 'debit', amount: '100.00' },
        { account: account('ACC-0003'), direction: 'debit', amount: '15.00' },
        { account: account('ACC-0001'), direction: 'credit', amount: '115.00' },
      ],
    })
    expect(files.json('/expenses/EXP-0001')).toMatchObject({ status: 'posted', grossAmount: '115.00', journal: { path: '/journals/EXP-0001' } })
    await expect(post(files, 'reverse-journal', '/journals/EXP-0001')).rejects.toThrow(/Reverse it from there/)
  })

  it('completes an interrupted expense posting without posting twice', async () => {
    const files = ledger({ '/expenses/EXP-0001': expense({ taxAmount: '0', taxCode: '' }) })
    const write = files.write
    files.write = async (path, ...rest) => {
      if (path === '/expenses/EXP-0001') throw new Error('connection lost')
      return write(path, ...rest)
    }
    await expect(post(files, 'post-expense', '/expenses/EXP-0001')).rejects.toThrow('connection lost')
    files.write = write
    await post(files, 'post-expense', '/expenses/EXP-0001')
    expect(files.json('/journals/EXP-0001').lines).toHaveLength(2)
    expect(files.json('/expenses/EXP-0001').status).toBe('posted')
  })

  it('refuses a journal name taken by something else', async () => {
    const files = ledger({ '/expenses/EXP-0001': expense(), '/journals/EXP-0001': journal({ code: 'EXP-0001' }) })
    await expect(post(files, 'post-expense', '/expenses/EXP-0001')).rejects.toThrow(/belongs to something else/)
    expect(files.json('/expenses/EXP-0001').status).toBe('draft')
  })

  it('needs a defined tax code for tax', async () => {
    const files = ledger({ '/expenses/EXP-0001': expense({ taxCode: 'GST' }) })
    await expect(post(files, 'post-expense', '/expenses/EXP-0001')).rejects.toThrow(/GST is not defined/)
  })

  it('reverses a posted expense through its journal', async () => {
    const files = ledger({ '/expenses/EXP-0001': expense() })
    await post(files, 'post-expense', '/expenses/EXP-0001')
    expect(await post(files, 'reverse-expense', '/expenses/EXP-0001')).toEqual({ message: 'Reversed EXP-0001 with EXP-0001-R', path: '/journals/EXP-0001-R' })
    expect(files.json('/journals/EXP-0001-R')).toMatchObject({ date: '2026-03-10', source: { path: '/expenses/EXP-0001' } })
    expect(files.json('/expenses/EXP-0001')).toMatchObject({ status: 'reversed', reversalJournal: { path: '/journals/EXP-0001-R' }, reversedAt: now })
  })

  it('only acts on records directly in its containers', async () => {
    await expect(post(ledger(), 'post-journal', '/expenses/EXP-0001')).rejects.toThrow(/directly in \/journals/)
    await expect(post(ledger(), 'post-journal', '/journals/a/b')).rejects.toThrow(/directly in \/journals/)
    await expect(post(ledger(), 'delete', '/journals/JRN-0001')).rejects.toThrow(/Unsupported operation/)
  })
})
