// Accounting's API script (see api.yaml): the ledger operations other apps call through the platform. Accounting owns
// its ledger rules here: the open period, active accounts, balanced lines and the base currency. It runs with
// Accounting's own file access; other apps never write /journals themselves.
import { serve } from './runtime.mjs'
import {
  accounting, balanceLines, createJournal, fail, ledgerSettings, nameOf, openPeriodFor, postedJournal, readAccounts,
  readRecord, reverseJournal, toMinor, formatMinor,
} from './ledger.mjs'
import { randomUUID } from 'node:crypto'

const codePattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

/**
 * Posts a balanced journal for another app's record, named after the record (`/journals/INV-0001`). Posting the same
 * record again with the same lines returns the journal already posted; different lines are refused.
 */
export async function postJournal(input, { files, caller, now }, { uuid = randomUUID } = {}) {
  const app = String(caller?.app ?? '')
  if (!app) fail('The calling app is unknown.')
  const code = String(input.source?.code ?? '')
  if (!codePattern.test(code)) fail('The source record needs a code to name its journal.')
  const ledger = await ledgerSettings(files)
  if (input.currency !== ledger.baseCurrency) fail(`The ledger is kept in ${ledger.baseCurrency}, not ${input.currency}.`)
  const digits = ledger.minorDigits
  // Amounts are normalised to the ledger's precision; directions and accounts are checked as Accounting posts them.
  const lines = input.lines.map(line => ({ ...line, amount: formatMinor(toMinor(line.amount, digits, 'Line amount'), digits) }))
  balanceLines(lines, digits)
  await readAccounts(files, lines.map(line => line.account))
  const period = await openPeriodFor(files, input.date)
  const path = `${accounting.journals}/${code}`
  const journal = {
    ...postedJournal({ code, date: input.date, description: input.description, currency: input.currency, period: period.path,
      lines, source: input.source.path, now, id: uuid() }),
    postedBy: { app },
  }
  const { created } = await createJournal(files, path, journal, 'source')
  return { path, period: period.path, created }
}

/** Reverses a journal the calling app posted, with a journal of every line flipped, in the period of `date`. */
export async function reverse(input, { files, caller, now }, { uuid = randomUUID } = {}) {
  const app = String(caller?.app ?? '')
  if (!app) fail('The calling app is unknown.')
  const path = String(input.journal ?? '')
  if (!path.startsWith(`${accounting.journals}/`)) fail('Choose a journal to reverse.')
  const original = await readRecord(files, path, 'journal')
  if (original.record.postedBy?.app !== app) fail(`${nameOf(path)} was not posted by ${app}; reverse it in Accounting.`)
  if (input.source?.path && original.record.source?.path !== input.source.path) fail(`${nameOf(path)} belongs to another record.`)
  const reversal = await reverseJournal(files, path, { date: input.date || now.slice(0, 10), reason: input.reason ?? '', now, uuid })
  return { path: reversal }
}

export default serve({ 'post-journal': postJournal, 'reverse-journal': reverse })
