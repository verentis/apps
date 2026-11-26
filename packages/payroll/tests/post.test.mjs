import { describe, expect, it } from 'vitest'
import { defaultSettings, seedProfiles, seedStructures, templates } from '../src/contracts.mjs'
import { defaultSettings as ledgerDefaults, starterAccounts, templates as ledgerTemplates } from '../../accounting/src/contracts.mjs'
import { computePayslip, periodEnd, run, runWithApps } from '../scripts/post/main.mjs'
import { postJournal } from '../../accounting/scripts/api/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-11-25T08:00:00Z'
let ids = 0
const options = { now, uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` }
const record = (kind, values, source = templates) => ({ ...source[kind], id: options.uuid(), createdAt: now, updatedAt: now, ...values })
const account = code => `/chart-of-accounts/${code}`
const settings = {
  ...defaultSettings,
  deductionsPayableAccount: account('ACC-0003'),
  netWagesPayableAccount: account('ACC-0001'),
  contributionPayableAccount: account('ACC-0004'),
}

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/accounting.json': { ...ledgerDefaults, baseCurrency: 'ZAR' },
    '/settings/payroll.json': settings,
    ...Object.fromEntries(starterAccounts.map(item => [account(item.code), item])),
    '/periods/PER-0001': record('period', { code: 'PER-0001', name: 'November', startDate: '2026-11-01', endDate: '2026-11-30', status: 'open' }, ledgerTemplates),
    '/salary-structures/PAYSTR-0001': seedStructures[0],
    '/pay-profiles/PAYEMP-0001': seedProfiles[0],
    '/pay-profiles/PAYEMP-0002': seedProfiles[1],
    '/pay-runs/PAYRUN-0001': record('payrun', { code: 'PAYRUN-0001', period: '2026-11' }),
    ...extra,
  })
}

// Posting runs as the script runs it: it prepares the journal, has Accounting post it through the platform (here
// Accounting's real operation against the same files) and completes the record, in one run.
const accounting = files => ({ call: async (app, operation, input) => ({ result: await postJournal(input, { files, caller: { app: 'payroll' }, now }, options) }) })
const call = (files, operation, path = '/pay-runs/PAYRUN-0001', extra = {}) => runWithApps({ operation, path, ...extra }, files, accounting(files), options)
const structure = rules => ({ ...seedStructures[0], rules })
const drule = (rate, extra = {}) => ({ code: 'DED', name: 'Deduction', kind: 'deduction', computation: 'percent-of-base', amount: '', rate, sequence: '20', ...extra })

describe('Payroll payslip computation', () => {
  it('rounds percent-of-base amounts half up to the minor unit and supports fixed amounts', () => {
    const slip = computePayslip({ employeeName: 'Alex', baseWage: '100.05' }, structure([
      { code: 'BASE', name: 'Base salary', kind: 'earning', computation: 'percent-of-base', amount: '', rate: '100', sequence: '10' },
      drule('10'),
      { code: 'ALLOW', name: 'Fixed allowance', kind: 'earning', computation: 'fixed', amount: '12.34', rate: '', sequence: '15' },
      { code: 'EC', name: 'Contribution', kind: 'employer-contribution', computation: 'percent-of-base', amount: '', rate: '0.125', sequence: '30' },
    ]), 2)
    // 10% of 100.05 is 10.005 → 10.01; 0.125% of 100.05 is 0.1250625 → 0.13 (both half up).
    expect(slip.lines.map(line => [line.rule, line.amount])).toEqual([
      ['BASE', '100.05'], ['ALLOW', '12.34'], ['DED', '10.01'], ['EC', '0.13'],
    ])
    expect(slip).toMatchObject({ gross: 11239n, deductions: 1001n, contributions: 13n, net: 10238n })
  })

  it('applies rules in sequence order and refuses deductions above the gross', () => {
    const slip = computePayslip({ employeeName: 'Alex', baseWage: '100.00' }, structure([
      drule('10', { sequence: '90' }),
      { code: 'BASE', name: 'Base salary', kind: 'earning', computation: 'percent-of-base', amount: '', rate: '100', sequence: '5' },
    ]), 2)
    expect(slip.lines[0].rule).toBe('BASE')
    expect(() => computePayslip({ employeeName: 'Alex', baseWage: '100.00' }, structure([
      { code: 'BASE', name: 'Base salary', kind: 'earning', computation: 'percent-of-base', amount: '', rate: '100', sequence: '10' },
      drule('150'),
    ]), 2)).toThrow(/deductions \(150\.00\) exceed the gross pay \(100\.00\)/)
    expect(() => computePayslip({ employeeName: 'Alex', baseWage: '100.00' }, structure([drule('10')]), 2)).toThrow(/no earnings/)
    expect(() => computePayslip({ employeeName: 'Alex', baseWage: '100.00' }, structure([]), 2)).toThrow(/has no rules/)
  })

  it('posts a pay run on the last day of its period', () => {
    expect(periodEnd('2026-11')).toBe('2026-11-30')
    expect(periodEnd('2028-02')).toBe('2028-02-29')
    expect(() => periodEnd('2026-13')).toThrow(/YYYY-MM/)
  })
})

describe('Payroll pay run script', () => {
  it('computes a payslip per active profile, approves and posts one balanced journal, then locks the run', async () => {
    const files = workspace()
    expect(await call(files, 'compute-run')).toMatchObject({ message: 'Computed PAYRUN-0001: 2 payslips, net 31500.00' })
    const computed = files.json('/pay-runs/PAYRUN-0001')
    expect(computed).toMatchObject({
      status: 'computed', computedAt: now, currency: 'ZAR',
      totals: { gross: '35000.00', deductions: '3500.00', contributions: '1750.00', net: '31500.00' },
    })
    expect(computed.payslips).toEqual([
      expect.objectContaining({ employee: 'Alex Taylor', profile: '/pay-profiles/PAYEMP-0001', base: '20000.00', gross: '20000.00', deductions: '2000.00', contributions: '1000.00', net: '18000.00' }),
      expect.objectContaining({ employee: 'Jordan Lee', profile: '/pay-profiles/PAYEMP-0002', base: '15000.00', gross: '15000.00', deductions: '1500.00', contributions: '750.00', net: '13500.00' }),
    ])
    expect(computed.payslips[0].lines).toEqual([
      { rule: 'BASE', name: 'Base salary', kind: 'earning', amount: '20000.00' },
      { rule: 'DED', name: 'Example deduction (10%)', kind: 'deduction', amount: '2000.00' },
      { rule: 'EC', name: 'Example employer contribution (5%)', kind: 'employer-contribution', amount: '1000.00' },
    ])
    expect(await call(files, 'approve-run')).toMatchObject({ message: 'Approved PAYRUN-0001 for 2026-11' })
    expect(await call(files, 'post-run')).toMatchObject({ message: 'Posted PAYRUN-0001 for 2026-11', path: '/journals/PAYRUN-0001' })
    const journal = files.json('/journals/PAYRUN-0001')
    expect(journal).toMatchObject({
      status: 'posted', date: '2026-11-30', currency: 'ZAR',
      source: { path: '/pay-runs/PAYRUN-0001' }, period: { path: '/periods/PER-0001' },
    })
    expect(journal.lines).toEqual([
      expect.objectContaining({ account: account('ACC-0006'), direction: 'debit', amount: '35000.00' }),
      expect.objectContaining({ account: account('ACC-0006'), direction: 'debit', amount: '1750.00' }),
      expect.objectContaining({ account: account('ACC-0003'), direction: 'credit', amount: '3500.00' }),
      expect.objectContaining({ account: account('ACC-0001'), direction: 'credit', amount: '31500.00' }),
      expect.objectContaining({ account: account('ACC-0004'), direction: 'credit', amount: '1750.00' }),
    ])
    const sum = direction => journal.lines.filter(line => line.direction === direction)
      .reduce((total, line) => total + BigInt(line.amount.replace('.', '')), 0n)
    expect(sum('debit')).toBe(sum('credit'))
    expect(files.json('/pay-runs/PAYRUN-0001')).toMatchObject({ status: 'posted', postedAt: now, journal: { path: '/journals/PAYRUN-0001' } })
  })

  it('is idempotent: posting again neither fails nor posts twice, and recomputing replaces the payslips', async () => {
    const files = workspace()
    await call(files, 'compute-run')
    await files.write('/pay-profiles/PAYEMP-0002', JSON.stringify({ ...seedProfiles[1], active: false }), { contentType: 'application/vnd.verentis.payroll.profile+json' })
    expect((await call(files, 'compute-run')).message).toBe('Computed PAYRUN-0001: 1 payslip, net 18000.00')
    await call(files, 'approve-run')
    expect(await call(files, 'approve-run')).toMatchObject({ message: 'PAYRUN-0001 is already approved' })
    await call(files, 'post-run')
    const writes = files.writes.length
    expect(await call(files, 'post-run')).toMatchObject({ message: 'PAYRUN-0001 is already posted', path: '/journals/PAYRUN-0001' })
    expect(files.writes.length).toBe(writes)
  })

  it('completes a post interrupted after its journal was written', async () => {
    const files = workspace()
    await call(files, 'compute-run')
    await call(files, 'approve-run')
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/pay-runs/PAYRUN-0001') throw new Error('network'); return write(path, ...args) }
    await expect(call(files, 'post-run')).rejects.toThrow('network')
    expect(files.nodes.has('/journals/PAYRUN-0001')).toBe(true)
    files.write = write
    await call(files, 'post-run')
    expect(files.json('/pay-runs/PAYRUN-0001').status).toBe('posted')
  })

  it('fails a save conflict instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, ...args) => { if (path === '/pay-runs/PAYRUN-0001') files.touch(path); files.write = write; return write(path, ...args) }
    await expect(call(files, 'compute-run')).rejects.toThrow(/changed while it was being posted/)
  })

  it.each([
    ['approving a draft run', 'approve-run', {}, /must be computed before it can be approved/],
    ['posting an unapproved run', 'post-run', { status: 'computed', computedAt: now, currency: 'ZAR', totals: { gross: '1.00', deductions: '0.00', contributions: '0.00', net: '1.00' }, payslips: [] }, /must be approved before it can be posted/],
    ['computing without a period', 'compute-run', { period: '' }, /period \(YYYY-MM\)/],
    ['a foreign currency', 'compute-run', { currency: 'USD' }, /kept in ZAR/],
  ])('refuses %s', async (_, operation, values, error) => {
    const files = workspace({ '/pay-runs/PAYRUN-0001': record('payrun', { code: 'PAYRUN-0001', period: '2026-11', ...values }) })
    await expect(call(files, operation)).rejects.toThrow(error)
    expect(files.nodes.has('/journals/PAYRUN-0001')).toBe(false)
  })

  it('refuses to recompute an approved run', async () => {
    const files = workspace()
    await call(files, 'compute-run')
    await call(files, 'approve-run')
    await expect(call(files, 'compute-run')).rejects.toThrow(/already approved/)
  })

  it('requires the payable accounts to be mapped before posting', async () => {
    const files = workspace({ '/settings/payroll.json': { ...settings, netWagesPayableAccount: '' } })
    await call(files, 'compute-run')
    await call(files, 'approve-run')
    await expect(call(files, 'post-run')).rejects.toThrow(/Choose the net wages payable account in Payroll settings/)
    expect(files.json('/pay-runs/PAYRUN-0001').status).toBe('approved')
  })

  it('requires an open period covering the pay run', async () => {
    const files = workspace({ '/periods/PER-0001': record('period', { code: 'PER-0001', name: 'November', startDate: '2026-11-01', endDate: '2026-11-30', status: 'closed' }, ledgerTemplates) })
    await call(files, 'compute-run')
    await call(files, 'approve-run')
    await expect(call(files, 'post-run')).rejects.toThrow(/is closed/)
  })

  it('refuses unknown operations and records outside their folder', async () => {
    const files = workspace()
    await expect(call(files, 'email')).rejects.toThrow(/Unsupported operation/)
    await expect(call(files, 'compute-run', '/salary-structures/PAYSTR-0001')).rejects.toThrow(/directly in \/pay-runs/)
  })
})
