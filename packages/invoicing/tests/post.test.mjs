import { describe, expect, it } from 'vitest'
import { defaultSettings, templates } from '../src/contracts.mjs'
import { defaultSettings as ledgerDefaults, starterAccounts, templates as ledgerTemplates } from '../../accounting/src/contracts.mjs'
import { lineTotals, run, runWithApps } from '../scripts/post/main.mjs'
import { postJournal, reverse as reverseJournal } from '../../accounting/scripts/api/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values, source = templates) => ({ ...source[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })
const seller = { ...defaultSettings.seller, name: 'Acme', legalName: 'Acme (Pty) Ltd', taxIdentifier: '4000' }

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/accounting.json': { ...ledgerDefaults, baseCurrency: 'ZAR' },
    '/settings/invoicing.json': { ...defaultSettings, seller },
    ...Object.fromEntries(starterAccounts.map(item => [`/chart-of-accounts/${item.code}`, item])),
    '/periods/PER-0001': record('period', { code: 'PER-0001', name: 'March', startDate: '2026-03-01', endDate: '2026-03-31', status: 'open' }, ledgerTemplates),
    ...extra,
  })
}

const invoice = (values = {}) => record('invoice', {
  code: 'INV-0001', issueDate: '2026-03-02', dueDate: '2026-04-01', currency: 'ZAR',
  customer: { ...templates.invoice.customer, name: 'Globex' },
  lines: [
    { description: 'Design', quantity: '3', unitPrice: '333.33', taxRate: '' },
    { description: 'Hosting', quantity: '1', unitPrice: '0.05', taxRate: '0' },
  ],
  ...values,
})
const credit = (values = {}) => record('credit', {
  code: 'CN-0001', date: '2026-03-05', currency: 'ZAR', invoice: '/invoices/INV-0001', reason: 'Discount',
  lines: [{ description: 'Discount', quantity: '1', unitPrice: '100', taxRate: '' }], ...values,
})
const payment = (values = {}) => record('payment', {
  code: 'PAY-0001', date: '2026-03-06', currency: 'ZAR', amount: '1000', bankAccount: '/chart-of-accounts/ACC-0001',
  allocations: [{ invoice: '/invoices/INV-0001', amount: '900' }], ...values,
})
// A posting runs as the form runs it: Invoicing's script returns the journal, Accounting posts it through its API
// (its real operation, as the platform would run it), then Invoicing completes the record with the posted journal.
const ledger = files => ({ files, caller: { app: 'invoicing' }, now })
// The platform's app call, here running Accounting's real operations against the same files.
const accounting = files => ({
  call: async (app, operation, input) => ({ app, operation, executionId: 'op-1',
    result: operation === 'reverse-journal' ? await reverseJournal(input, ledger(files), options) : await postJournal(input, ledger(files), options) }),
})
const call = (files, operation, path, extra = {}) => runWithApps({ operation, path, ...extra }, files, accounting(files), options)
const issued = async (extra = {}) => {
  const files = workspace({ '/invoices/INV-0001': invoice(), ...extra })
  await call(files, 'issue-invoice', '/invoices/INV-0001')
  return files
}

describe('Invoicing line totals', () => {
  it('rounds each line half up to the cent and sums the rounded lines', () => {
    const totals = lineTotals([
      { description: 'a', quantity: '0.333', unitPrice: '10.00', taxRate: '15' },
      { description: 'b', quantity: '1', unitPrice: '0.03', taxRate: '' },
    ], 2, '15')
    // 3.33 net (3.33 tax 0.4995 → 0.50); 0.03 net (tax 0.0045 → 0.00).
    expect(totals).toMatchObject({ net: 336n, tax: 50n, gross: 386n })
    expect(totals.lines[1].taxRate).toBe('15')
  })

  it.each([[[], /at least one line/], [[{ description: ' ', quantity: '1', unitPrice: '1', taxRate: '0' }], /needs a description/]])(
    'refuses %j', (lines, error) => expect(() => lineTotals(lines, 2)).toThrow(error))
})

describe('Invoicing posting script', () => {
  it('issues an invoice: posts its journal, snapshots the seller and writes a document copy', async () => {
    const files = await issued()
    const saved = files.json('/invoices/INV-0001')
    expect(saved).toMatchObject({
      status: 'issued', issuedAt: now, seller: { name: 'Acme' },
      totals: { net: '1000.04', tax: '150.00', gross: '1150.04' },
      lines: [{ unitPrice: '333.33', taxRate: '15' }, { unitPrice: '0.05', taxRate: '0' }],
      journal: { path: '/journals/INV-0001' }, document: { path: '/invoices/INV-0001/documents/INV-0001.md' },
    })
    expect(files.json('/journals/INV-0001')).toMatchObject({
      status: 'posted', source: { path: '/invoices/INV-0001' }, period: { path: '/periods/PER-0001' },
      lines: [
        { account: '/chart-of-accounts/ACC-0002', direction: 'debit', amount: '1150.04' },
        { account: '/chart-of-accounts/ACC-0005', direction: 'credit', amount: '1000.04' },
        { account: '/chart-of-accounts/ACC-0003', direction: 'credit', amount: '150.00' },
      ],
    })
    const document = files.nodes.get('/invoices/INV-0001/documents/INV-0001.md')
    expect(document.contentType).toBe('text/markdown')
    expect(document.content).toContain('# Invoice INV-0001')
    expect(document.content).toContain('Acme (Pty) Ltd')
    expect(document.content).toContain('| **Total** | **1150.04** |')
    expect(await call(files, 'issue-invoice', '/invoices/INV-0001')).toMatchObject({ message: 'INV-0001 is already issued' })
  })

  it('completes an issue interrupted after its journal was posted', async () => {
    const files = workspace({ '/invoices/INV-0001': invoice() })
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/invoices/INV-0001') throw new Error('network'); return write(path, ...args) }
    await expect(call(files, 'issue-invoice', '/invoices/INV-0001')).rejects.toThrow('network')
    files.write = write
    await call(files, 'issue-invoice', '/invoices/INV-0001')
    expect(files.json('/invoices/INV-0001').status).toBe('issued')
  })

  it.each([
    ['no customer', invoice({ customer: templates.invoice.customer }), /customer's name/],
    ['a due date before the issue date', invoice({ dueDate: '2026-03-01' }), /due date/],
    ['a foreign currency', invoice({ currency: 'USD' }), /kept in ZAR/],
    ['a zero total', invoice({ lines: [{ description: 'Free', quantity: '1', unitPrice: '0', taxRate: '' }] }), /total is zero/],
  ])('refuses to issue an invoice with %s', async (_, value, error) => {
    const files = workspace({ '/invoices/INV-0001': value })
    await expect(call(files, 'issue-invoice', '/invoices/INV-0001')).rejects.toThrow(error)
    expect(files.json('/invoices/INV-0001').status).toBe('draft')
    expect(files.nodes.has('/journals/INV-0001')).toBe(false)
  })

  it('issues a credit note against the invoice\'s customer up to what is outstanding', async () => {
    const files = await issued({ '/credit-notes/CN-0001': credit(), '/credit-notes/CN-0002': credit({ code: 'CN-0002', lines: [{ description: 'More', quantity: '1', unitPrice: '1000', taxRate: '' }] }) })
    expect(await call(files, 'issue-credit', '/credit-notes/CN-0001')).toMatchObject({ message: 'Issued CN-0001 against INV-0001' })
    expect(files.json('/credit-notes/CN-0001')).toMatchObject({ status: 'issued', customer: { name: 'Globex' }, totals: { gross: '115.00' } })
    expect(files.json('/journals/CN-0001').lines).toEqual([
      expect.objectContaining({ account: '/chart-of-accounts/ACC-0005', direction: 'debit', amount: '100.00' }),
      expect.objectContaining({ account: '/chart-of-accounts/ACC-0003', direction: 'debit', amount: '15.00' }),
      expect.objectContaining({ account: '/chart-of-accounts/ACC-0002', direction: 'credit', amount: '115.00' }),
    ])
    await expect(call(files, 'issue-credit', '/credit-notes/CN-0002')).rejects.toThrow(/\(1150\.00\) is more than INV-0001 has outstanding \(1035\.04\)/)
  })

  it('refuses to credit an invoice that has not been issued', async () => {
    const files = workspace({ '/invoices/INV-0001': invoice(), '/credit-notes/CN-0001': credit() })
    await expect(call(files, 'issue-credit', '/credit-notes/CN-0001')).rejects.toThrow(/has not been issued/)
  })

  it('posts a payment, allocating part and leaving the rest on account', async () => {
    const files = await issued({ '/payments/PAY-0001': payment() })
    expect(await call(files, 'post-payment', '/payments/PAY-0001')).toMatchObject({ message: 'Posted PAY-0001 (100.00 unallocated)' })
    expect(files.json('/payments/PAY-0001')).toMatchObject({ status: 'posted', amount: '1000.00', allocations: [{ amount: '900.00' }] })
    expect(files.json('/journals/PAY-0001').lines).toEqual([
      expect.objectContaining({ account: '/chart-of-accounts/ACC-0001', direction: 'debit', amount: '1000.00' }),
      expect.objectContaining({ account: '/chart-of-accounts/ACC-0002', direction: 'credit', amount: '1000.00' }),
    ])
  })

  it.each([
    ['more than outstanding', payment({ amount: '2000', allocations: [{ invoice: '/invoices/INV-0001', amount: '1150.05' }] }), /has 1150\.04 outstanding/],
    ['more than the payment', payment({ amount: '10' }), /allocations \(900\.00\) are more than the payment \(10\.00\)/],
    ['the same invoice twice', payment({ allocations: [{ invoice: '/invoices/INV-0001', amount: '1' }, { invoice: '/invoices/INV-0001', amount: '1' }] }), /allocated twice/],
  ])('refuses a payment allocating %s', async (_, value, error) => {
    const files = await issued({ '/payments/PAY-0001': value })
    await expect(call(files, 'post-payment', '/payments/PAY-0001')).rejects.toThrow(error)
  })

  it('counts earlier posted payments, and releases them when reversed', async () => {
    const files = await issued({ '/payments/PAY-0001': payment(), '/payments/PAY-0002': payment({ code: 'PAY-0002', amount: '300', allocations: [{ invoice: '/invoices/INV-0001', amount: '300' }] }) })
    await call(files, 'post-payment', '/payments/PAY-0001')
    await expect(call(files, 'post-payment', '/payments/PAY-0002')).rejects.toThrow(/has 250\.04 outstanding/)
    expect(await call(files, 'reverse-payment', '/payments/PAY-0001', { reason: 'Bounced' })).toMatchObject({ message: 'Reversed PAY-0001 with PAY-0001-R' })
    expect(files.json('/payments/PAY-0001')).toMatchObject({ status: 'reversed', reversalJournal: { path: '/journals/PAY-0001-R' } })
    await call(files, 'post-payment', '/payments/PAY-0002')
    expect(files.json('/payments/PAY-0002').status).toBe('posted')
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace()
    await expect(call(files, 'email', '/invoices/INV-0001')).rejects.toThrow(/Unsupported operation/)
    await expect(call(files, 'issue-invoice', '/payments/PAY-0001')).rejects.toThrow(/directly in \/invoices/)
  })
})
