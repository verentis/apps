// Computes, approves and posts Payroll pay runs against the Accounting ledger. Canvas forms run this script
// (run-script) against a saved record; it computes payslips from the salary structures (region-agnostic: the
// rules are user data, there are no built-in tax tables), enforces the draft → computed → approved → posted
// transitions and posts one balanced journal per run with the file access its installer consented to.
//
// Integrity model: journals get deterministic names (`/journals/PAYRUN-0001`) and are created create-only, so a
// retried operation never posts twice; records are updated conditionally (If-Match), so a concurrent edit fails
// instead of being overwritten. The steps are not one transaction: if a run stops between writing the journal and
// updating the record, running the same operation again completes it.
import { randomUUID } from 'node:crypto'
import {
  accounting, balanceLines, createJournal, divideHalfUp, fail, formatMinor, journalLine, ledgerSettings, nameOf,
  nowIso, openPeriodFor, parseDecimal, postedJournal, readAccounts, readFolder, readRecord, readSettings, saveRecord,
  toMinor,
} from './ledger.mjs'

export const operations = ['compute-run', 'approve-run', 'post-run']
export const payroll = {
  settingsPath: '/settings/payroll.json',
  structures: '/salary-structures',
  profiles: '/pay-profiles',
  runs: '/pay-runs',
  mime: kind => `application/vnd.verentis.payroll.${kind}+json`,
}
export const ruleKinds = ['earning', 'deduction', 'employer-contribution']
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/

function checkPath(path, container) {
  if (typeof path !== 'string' || !path.startsWith(`${container}/`) || path.slice(container.length + 1).includes('/')) {
    fail(`Expected a record directly in ${container} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

const label = record => record.code || 'This record'

function checkActive(record) {
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
}

function checkCurrency(record, ledger) {
  const currency = record.currency || ledger.baseCurrency
  if (currency !== ledger.baseCurrency) fail(`The ledger is kept in ${ledger.baseCurrency}; ${label(record)} is in ${currency}.`)
  return currency
}

/** The last day of a `YYYY-MM` pay period: the date the run's journal is posted on. */
export function periodEnd(period) {
  if (!periodPattern.test(period ?? '')) fail('Enter the pay run period (YYYY-MM) first.')
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

const accountKeys = {
  wageExpenseAccount: 'wage expense',
  deductionsPayableAccount: 'deductions payable',
  netWagesPayableAccount: 'net wages payable',
  contributionExpenseAccount: 'employer contribution expense',
  contributionPayableAccount: 'employer contributions payable',
}

async function settings(files, needed) {
  const values = await readSettings(files, payroll.settingsPath, 'Payroll')
  for (const key of needed) {
    if (!values[key]) fail(`Choose the ${accountKeys[key]} account in Payroll settings first.`)
  }
  return values
}

/**
 * One employee's payslip in minor units: every structure rule applied in sequence order to the profile's base
 * wage. `fixed` rules take their exact amount; `percent-of-base` rules take rate% of the base, rounded half up
 * to the currency's minor unit. The net pay is gross earnings less deductions; employer contributions are an
 * extra employer cost on top.
 */
export function computePayslip(profile, structure, digits) {
  const who = profile.employeeName || label(profile)
  const base = toMinor(profile.baseWage, digits, `${who}'s base wage`)
  if (base === 0n) fail(`Enter ${who}'s base monthly wage first.`)
  const rules = Array.isArray(structure.rules) ? [...structure.rules] : []
  if (rules.length === 0) fail(`${label(structure)} has no rules. Add at least one rule to the structure.`)
  rules.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
  let gross = 0n
  let deductions = 0n
  let contributions = 0n
  const lines = rules.map((rule, index) => {
    const at = `${label(structure)} rule ${index + 1}`
    if (!String(rule.code ?? '').trim()) fail(`${at} needs a code.`)
    if (!String(rule.name ?? '').trim()) fail(`${at} needs a name.`)
    if (!ruleKinds.includes(rule.kind)) fail(`${at} must be an earning, a deduction or an employer contribution.`)
    let amount
    if (rule.computation === 'fixed') {
      amount = toMinor(rule.amount, digits, `${at} amount`)
    } else if (rule.computation === 'percent-of-base') {
      const rate = parseDecimal(rule.rate, `${at} rate`, 4)
      amount = divideHalfUp(base * rate.units, 100n * 10n ** BigInt(rate.scale))
    } else {
      fail(`${at} must be computed as fixed or percent-of-base.`)
    }
    if (rule.kind === 'earning') gross += amount
    else if (rule.kind === 'deduction') deductions += amount
    else contributions += amount
    return { rule: rule.code.trim(), name: rule.name.trim(), kind: rule.kind, amount: formatMinor(amount, digits) }
  })
  if (gross === 0n) fail(`${who}'s payslip has no earnings. Add an earning rule to ${label(structure)}.`)
  if (deductions > gross) fail(`${who}'s deductions (${formatMinor(deductions, digits)}) exceed the gross pay (${formatMinor(gross, digits)}).`)
  return {
    employee: who, base, lines, gross, deductions, contributions, net: gross - deductions,
  }
}

const formatTotals = ({ gross, deductions, contributions, net }, digits) => ({
  gross: formatMinor(gross, digits), deductions: formatMinor(deductions, digits),
  contributions: formatMinor(contributions, digits), net: formatMinor(net, digits),
})

export async function computeRun(files, path, { now }) {
  const run = await readRecord(files, checkPath(path, payroll.runs), 'payrun')
  const { record } = run
  checkActive(record)
  if (record.status === 'approved' || record.status === 'posted') {
    fail(`${label(record)} is already ${record.status}. Only draft or computed runs can be computed.`)
  }
  if (!periodPattern.test(record.period ?? '')) fail('Enter the pay run period (YYYY-MM) before computing.')
  const ledger = await ledgerSettings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const profiles = (await readFolder(files, payroll.profiles, payroll.mime('profile'), 'profile'))
    .filter(({ record: profile }) => profile.state !== 'archived' && profile.active === true)
    .sort((a, b) => (a.record.code || a.name).localeCompare(b.record.code || b.name))
  if (profiles.length === 0) fail(`There are no active pay profiles in ${payroll.profiles}. Create one first.`)
  const structures = new Map()
  const totals = { gross: 0n, deductions: 0n, contributions: 0n, net: 0n }
  const payslips = []
  for (const { path: profilePath, record: profile } of profiles) {
    const who = profile.employeeName || label(profile)
    if (profile.currency && profile.currency !== currency) fail(`${who}'s pay profile is in ${profile.currency}; the run is in ${currency}.`)
    const structurePath = profile.structure
    checkPath(typeof structurePath === 'string' && structurePath ? structurePath : fail(`Choose ${who}'s salary structure first.`), payroll.structures)
    if (!structures.has(structurePath)) {
      const structure = await readRecord(files, structurePath, 'structure')
      checkActive(structure.record)
      structures.set(structurePath, structure.record)
    }
    const slip = computePayslip(profile, structures.get(structurePath), digits)
    totals.gross += slip.gross
    totals.deductions += slip.deductions
    totals.contributions += slip.contributions
    totals.net += slip.net
    payslips.push({
      employee: slip.employee, profile: profilePath, base: formatMinor(slip.base, digits), lines: slip.lines,
      gross: formatMinor(slip.gross, digits), deductions: formatMinor(slip.deductions, digits),
      contributions: formatMinor(slip.contributions, digits), net: formatMinor(slip.net, digits),
    })
  }
  Object.assign(record, {
    currency, payslips, totals: formatTotals(totals, digits), status: 'computed', computedAt: now, updatedAt: now,
  })
  await saveRecord(files, run, payroll.mime('payrun'))
  return { message: `Computed ${label(record)}: ${payslips.length} payslip${payslips.length === 1 ? '' : 's'}, net ${formatMinor(totals.net, digits)}`, path }
}

export async function approveRun(files, path, { now }) {
  const run = await readRecord(files, checkPath(path, payroll.runs), 'payrun')
  const { record } = run
  checkActive(record)
  if (record.status === 'approved' || record.status === 'posted') return { message: `${label(record)} is already ${record.status}`, path }
  if (record.status !== 'computed') fail(`${label(record)} must be computed before it can be approved.`)
  Object.assign(record, { status: 'approved', approvedAt: now, updatedAt: now })
  await saveRecord(files, run, payroll.mime('payrun'))
  return { message: `Approved ${label(record)} for ${record.period}`, path }
}

export async function postRun(files, path, { now, uuid }) {
  const run = await readRecord(files, checkPath(path, payroll.runs), 'payrun')
  const { record } = run
  checkActive(record)
  if (record.status === 'posted') return { message: `${label(record)} is already posted`, path: record.journal?.path ?? path }
  if (record.status !== 'approved') fail(`${label(record)} must be approved before it can be posted.`)
  const ledger = await ledgerSettings(files)
  const currency = checkCurrency(record, ledger)
  const digits = ledger.minorDigits
  const gross = toMinor(record.totals?.gross, digits, 'Gross total')
  const deductions = toMinor(record.totals?.deductions, digits, 'Deductions total')
  const contributions = toMinor(record.totals?.contributions, digits, 'Contributions total')
  const net = toMinor(record.totals?.net, digits, 'Net total')
  if (gross !== deductions + net) fail(`${label(record)}'s totals do not add up. Compute it again.`)
  if (gross + contributions === 0n) fail(`${label(record)}'s total is zero. Compute it again.`)
  const config = await settings(files, [
    ...(gross ? ['wageExpenseAccount', 'netWagesPayableAccount'] : []),
    ...(deductions ? ['deductionsPayableAccount'] : []),
    ...(contributions ? ['contributionExpenseAccount', 'contributionPayableAccount'] : []),
  ])
  const memo = `${record.code} · ${record.period}`
  const lines = [
    ...(gross ? [journalLine(config.wageExpenseAccount, 'debit', gross, digits, memo)] : []),
    ...(contributions ? [journalLine(config.contributionExpenseAccount, 'debit', contributions, digits, memo)] : []),
    ...(deductions ? [journalLine(config.deductionsPayableAccount, 'credit', deductions, digits, memo)] : []),
    ...(net ? [journalLine(config.netWagesPayableAccount, 'credit', net, digits, memo)] : []),
    ...(contributions ? [journalLine(config.contributionPayableAccount, 'credit', contributions, digits, memo)] : []),
  ]
  balanceLines(lines, digits)
  await readAccounts(files, lines.map(item => item.account))
  const date = periodEnd(record.period)
  const period = await openPeriodFor(files, date)
  const journalPath = `${accounting.journals}/${nameOf(path)}`
  await createJournal(files, journalPath, postedJournal({
    code: nameOf(journalPath), date, description: `Pay run ${memo}`, currency, period: period.path, lines, source: path, now, id: uuid(),
  }), 'source')
  Object.assign(record, { status: 'posted', postedAt: now, journal: { path: journalPath }, updatedAt: now })
  await saveRecord(files, run, payroll.mime('payrun'))
  return { message: `Posted ${label(record)} for ${record.period}`, path: journalPath }
}

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now, uuid }
  if (operation === 'compute-run') return computeRun(files, path, options)
  if (operation === 'approve-run') return approveRun(files, path, options)
  if (operation === 'post-run') return postRun(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
