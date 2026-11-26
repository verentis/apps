import { describe, expect, it } from 'vitest'
import { containers, defaultSettings, starterCategories, templates } from '../src/contracts.mjs'
import { defaultSettings as ledgerDefaults, starterAccounts, templates as ledgerTemplates } from '../../accounting/src/contracts.mjs'
import { reportTotal, run } from '../scripts/post/main.mjs'
import { postJournal } from '../../accounting/scripts/api/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values, source = templates) => ({ ...source[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })
const categoryPath = code => `${containers.categories.path}/${code}`

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/accounting.json': { ...ledgerDefaults, baseCurrency: 'ZAR' },
    '/settings/expenses.json': defaultSettings,
    ...Object.fromEntries(starterAccounts.map(item => [`/chart-of-accounts/${item.code}`, item])),
    '/periods/PER-0001': record('period', { code: 'PER-0001', name: 'March', startDate: '2026-03-01', endDate: '2026-03-31', status: 'open' }, ledgerTemplates),
    ...Object.fromEntries(starterCategories.map(item => [categoryPath(item.code), item])),
    [categoryPath('CAT-0004')]: record('category', { code: 'CAT-0004', name: 'Software', expenseAccount: '/chart-of-accounts/ACC-0004' }),
    ...extra,
  })
}

const report = (values = {}) => record('report', {
  code: 'EXP-0001', employeeName: 'Jo Soap', employeeRef: 'HR-42', date: '2026-03-03',
  lines: [
    { category: categoryPath('CAT-0001'), description: 'Flights', amount: '1200.50', date: '2026-03-02' },
    { category: categoryPath('CAT-0004'), description: 'IDE licence', amount: '99.50', date: '' },
  ],
  ...values,
})
// Posting runs as the form runs it: the script returns the journal, Accounting posts it through its API (its real
// operation, as the platform would run it), then the script completes the record with the posted journal.
async function call(files, operation, path = '/expense-reports/EXP-0001', extra = {}) {
  const first = await run({ operation, path, ...extra }, files, options)
  if (operation !== 'post-report' || !first.journalRequest) return first
  const posted = await postJournal(first.journalRequest, { files, caller: { app: 'expenses' }, now }, options)
  return run({ operation: 'complete-report', path, journal: posted.path }, files, options)
}
const approve = (files, extra = { approver: 'Fin Manager' }) => call(files, 'approve-report', '/expense-reports/EXP-0001', extra)

describe('Expenses report totals', () => {
  it('sums exact minor units and keeps per-line validation', () => {
    expect(reportTotal(report().lines, 2)).toBe(130000n)
  })

  it.each([
    [[], /at least one expense line/],
    [[{ category: '', description: 'Taxi', amount: '10', date: '' }], /needs a category/],
    [[{ category: categoryPath('CAT-0001'), description: ' ', amount: '10', date: '' }], /needs a description/],
    [[{ category: categoryPath('CAT-0001'), description: 'Taxi', amount: '0', date: '' }], /has no amount/],
    [[{ category: categoryPath('CAT-0001'), description: 'Taxi', amount: '-5', date: '' }], /non-negative decimal amount/],
    [[{ category: categoryPath('CAT-0001'), description: 'Taxi', amount: '10', date: 'soon' }], /invalid date/],
  ])('refuses %j', (lines, error) => expect(() => reportTotal(lines, 2)).toThrow(error))
})

describe('Expenses posting script', () => {
  it('moves a report through submit, approve and post, writing one balanced journal', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    expect(await call(files, 'submit-report')).toMatchObject({ message: 'Submitted EXP-0001 (1300.00) for approval' })
    expect(files.json('/expense-reports/EXP-0001')).toMatchObject({ status: 'submitted', submittedAt: now, total: '1300.00' })
    expect(await approve(files)).toMatchObject({ message: 'Approved EXP-0001' })
    expect(files.json('/expense-reports/EXP-0001')).toMatchObject({ status: 'approved', approver: 'Fin Manager', approvedAt: now })
    expect(await call(files, 'post-report')).toMatchObject({ message: 'Posted EXP-0001 (1300.00)', path: '/journals/EXP-0001' })
    expect(files.json('/expense-reports/EXP-0001')).toMatchObject({
      status: 'posted', postedAt: now, total: '1300.00', journal: { path: '/journals/EXP-0001' },
    })
    expect(files.json('/journals/EXP-0001')).toMatchObject({
      status: 'posted', currency: 'ZAR', date: '2026-03-03',
      source: { path: '/expense-reports/EXP-0001' }, period: { path: '/periods/PER-0001' },
      lines: [
        { account: '/chart-of-accounts/ACC-0006', direction: 'debit', amount: '1200.50' },
        { account: '/chart-of-accounts/ACC-0004', direction: 'debit', amount: '99.50' },
        { account: '/chart-of-accounts/ACC-0001', direction: 'credit', amount: '1300.00' },
      ],
    })
  })

  it('reports already-done operations instead of failing, so re-runs are idempotent', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    await call(files, 'submit-report')
    expect(await call(files, 'submit-report')).toMatchObject({ message: 'EXP-0001 is already submitted' })
    await approve(files)
    expect(await approve(files)).toMatchObject({ message: 'EXP-0001 is already approved' })
    await call(files, 'post-report')
    const journal = files.nodes.get('/journals/EXP-0001').etag
    expect(await call(files, 'post-report')).toMatchObject({ message: 'EXP-0001 is already posted', path: '/journals/EXP-0001' })
    expect(await approve(files)).toMatchObject({ message: 'EXP-0001 is already approved' })
    expect(files.nodes.get('/journals/EXP-0001').etag).toBe(journal)
  })

  it('completes a post interrupted after its journal was written', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report({ status: 'approved', submittedAt: now, total: '1300.00', approver: 'Fin Manager', approvedAt: now }) })
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/expense-reports/EXP-0001') throw new Error('network'); return write(path, ...args) }
    await expect(call(files, 'post-report')).rejects.toThrow('network')
    files.write = write
    await call(files, 'post-report')
    expect(files.json('/expense-reports/EXP-0001')).toMatchObject({ status: 'posted', journal: { path: '/journals/EXP-0001' } })
  })

  it.each([
    ['approve a draft', 'approve-report', { approver: 'Fin Manager' }, /is draft\. Submit it before approving/],
    ['refuse a draft', 'refuse-report', { reason: 'No receipts' }, /is draft\. Only submitted reports can be refused/],
    ['post a draft', 'post-report', {}, /is draft\. Approve it before posting/],
  ])('refuses to %s', async (_, operation, extra, error) => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    await expect(call(files, operation, '/expense-reports/EXP-0001', extra)).rejects.toThrow(error)
    expect(files.json('/expense-reports/EXP-0001').status).toBe('draft')
    expect(files.nodes.has('/journals/EXP-0001')).toBe(false)
  })

  it('refuses to post a submitted (unapproved) report or resubmit beyond draft', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    await call(files, 'submit-report')
    await expect(call(files, 'post-report')).rejects.toThrow(/is submitted\. Approve it before posting/)
    await approve(files)
    await expect(call(files, 'submit-report')).rejects.toThrow(/is approved and can no longer be submitted/)
    await expect(call(files, 'refuse-report', '/expense-reports/EXP-0001', { reason: 'Late' })).rejects.toThrow(/Only submitted reports can be refused/)
  })

  it('refuses a submitted report with the reason, and keeps it out of the ledger', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    await call(files, 'submit-report')
    await expect(call(files, 'refuse-report')).rejects.toThrow(/Give the reason/)
    expect(await call(files, 'refuse-report', '/expense-reports/EXP-0001', { reason: 'No receipts attached' })).toMatchObject({ message: 'Refused EXP-0001' })
    expect(files.json('/expense-reports/EXP-0001')).toMatchObject({ status: 'refused', refusalReason: 'No receipts attached', refusedAt: now })
    await expect(approve(files)).rejects.toThrow(/is refused\. Submit it before approving/)
    await expect(call(files, 'post-report')).rejects.toThrow(/is refused\. Approve it before posting/)
    expect(files.nodes.has('/journals/EXP-0001')).toBe(false)
  })

  it.each([
    ['no employee name', report({ employeeName: ' ' }), /employee's name/],
    ['no date', report({ date: '' }), /report date/],
    ['no lines', report({ lines: [] }), /at least one expense line/],
    ['a zero amount', report({ lines: [{ category: categoryPath('CAT-0001'), description: 'Taxi', amount: '0', date: '' }] }), /has no amount/],
    ['a negative amount', report({ lines: [{ category: categoryPath('CAT-0001'), description: 'Taxi', amount: '-5', date: '' }] }), /non-negative decimal amount/],
  ])('refuses to submit a report with %s', async (_, value, error) => {
    const files = workspace({ '/expense-reports/EXP-0001': value })
    await expect(call(files, 'submit-report')).rejects.toThrow(error)
    expect(files.json('/expense-reports/EXP-0001').status).toBe('draft')
  })

  it('refuses to approve without an approver', async () => {
    const files = workspace({ '/expense-reports/EXP-0001': report() })
    await call(files, 'submit-report')
    await expect(approve(files, { approver: '  ' })).rejects.toThrow(/approver's name/)
    expect(files.json('/expense-reports/EXP-0001').status).toBe('submitted')
  })

  it('validates posting against the chart of accounts and open periods', async () => {
    const approved = { status: 'approved', submittedAt: now, total: '1300.00', approver: 'Fin Manager', approvedAt: now }
    const closed = workspace({ '/expense-reports/EXP-0001': report({ ...approved, date: '2026-04-05' }) })
    await expect(call(closed, 'post-report')).rejects.toThrow(/No accounting period covers 2026-04-05/)
    const missing = workspace({ '/expense-reports/EXP-0001': report(approved) })
    missing.nodes.delete('/chart-of-accounts/ACC-0006')
    await expect(call(missing, 'post-report')).rejects.toThrow(/Account \/chart-of-accounts\/ACC-0006 does not exist/)
    const blank = workspace({
      '/expense-reports/EXP-0001': report(approved),
      [categoryPath('CAT-0001')]: record('category', { code: 'CAT-0001', name: 'Travel', expenseAccount: '' }),
    })
    await expect(call(blank, 'post-report')).rejects.toThrow(/Choose the expense account of category Travel/)
    for (const files of [closed, missing, blank]) {
      expect(files.json('/expense-reports/EXP-0001').status).toBe('approved')
      expect(files.nodes.has('/journals/EXP-0001')).toBe(false)
    }
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace()
    await expect(call(files, 'email')).rejects.toThrow(/Unsupported operation/)
    await expect(call(files, 'submit-report', '/expense-categories/CAT-0001')).rejects.toThrow(/directly in \/expense-reports/)
  })
})
