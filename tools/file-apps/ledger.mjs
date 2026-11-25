// Shared ledger primitives for the Accounting and Invoicing scripts (generated copies live in each app's
// `scripts/*/ledger.mjs`; edit tools/file-apps/ledger.mjs). Money is carried as exact decimal strings in files
// and as BigInt minor units here, so no amount is ever rounded through floating point.

export const accounting = {
  settingsPath: '/settings/accounting.json',
  accounts: '/chart-of-accounts',
  periods: '/periods',
  journals: '/journals',
  mime: kind => `application/vnd.verentis.accounting.${kind}+json`,
  schema: kind => `https://schemas.verentis.io/accounting/v1/${kind}.schema.json`,
}

export class LedgerError extends Error {}
export const fail = message => { throw new LedgerError(message) }
export const statusOf = error => error?.statusCode ?? error?.status

const decimal = /^(0|[1-9][0-9]{0,14})(\.([0-9]{1,4}))?$/

/** `"12.50"` → `1250n` for two minor digits. Rejects negative, malformed or over-precise amounts. */
export function toMinor(value, digits, label = 'Amount') {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  const match = typeof text === 'string' && text.trim().match(decimal)
  if (!match) fail(`${label} must be a non-negative decimal amount, e.g. 1250.00 (got ${JSON.stringify(value ?? '')}).`)
  const fraction = match[3] ?? ''
  if (fraction.length > digits) fail(`${label} ${text} has more than ${digits} decimal places.`)
  return BigInt(match[1] + fraction.padEnd(digits, '0'))
}

/** `1250n` → `"12.50"` for two minor digits. */
export function formatMinor(minor, digits) {
  const negative = minor < 0n
  const units = (negative ? -minor : minor).toString().padStart(digits + 1, '0')
  const whole = digits ? `${units.slice(0, -digits)}.${units.slice(-digits)}` : units
  return negative ? `-${whole}` : whole
}

/** Non-negative BigInt division rounded half up. */
export function divideHalfUp(numerator, denominator) {
  if (denominator <= 0n || numerator < 0n) fail('Rounding needs a non-negative amount and a positive divisor.')
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/** A decimal string as `{ units, scale }`, for quantities and percentages. */
export function parseDecimal(value, label, maxScale = 4) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  const match = typeof text === 'string' && text.trim().match(/^(0|[1-9][0-9]{0,11})(\.([0-9]{1,6}))?$/)
  if (!match) fail(`${label} must be a non-negative decimal number (got ${JSON.stringify(value ?? '')}).`)
  const fraction = match[3] ?? ''
  if (fraction.length > maxScale) fail(`${label} ${text} has more than ${maxScale} decimal places.`)
  return { units: BigInt(match[1] + fraction), scale: fraction.length }
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
export const parentOf = path => path.slice(0, path.lastIndexOf('/')) || '/'
export const nameOf = path => path.slice(path.lastIndexOf('/') + 1)
const sameDate = /^\d{4}-\d{2}-\d{2}$/

/** Every direct child of a folder (`{ name, path, mimeType }`), across pages. */
export async function listFolder(files, path) {
  const children = []
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const response = await files.list(path, 500, pageNo)
    const page = response?.children ?? response
    const items = Array.isArray(page) ? page : page?.data ?? []
    for (const item of items) {
      const name = item.name ?? nameOf(item.path ?? '')
      children.push({ name, path: item.path ?? `${path.replace(/\/+$/, '')}/${name}`, mimeType: item.mimeType ?? item.contentType ?? '' })
    }
    const pageCount = Array.isArray(page) ? 1 : page?.pageCount ?? 1
    if (pageNo >= pageCount || items.length === 0) break
  }
  return children
}

/** The parsed records of one kind (and vendor MIME) in a folder. */
export async function readFolder(files, path, mime, kind) {
  const records = []
  for (const child of await listFolder(files, path)) {
    if (child.mimeType && child.mimeType !== mime) continue
    try {
      const record = await files.readJson(child.path)
      if (record?.kind === kind) records.push({ path: child.path, name: child.name, record })
    } catch (error) {
      if (statusOf(error) !== 404 && !(error instanceof SyntaxError)) throw error
    }
  }
  return records
}

/** A record with the ETag it was read at, so the update can be conditional. */
export async function readRecord(files, path, kind) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (kind && record?.kind !== kind) fail(`${path} is not ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed record back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
export async function saveRecord(files, { path, record, etag }, mime) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being posted. Reload it and try again.`)
    throw error
  }
}

export async function readSettings(files, path, label) {
  try {
    return await files.readJson(path)
  } catch (error) {
    if (statusOf(error) === 404) fail(`${label} settings are missing (${path}). Reinstall the app to recreate them.`)
    throw error
  }
}

/** The ledger's base currency and precision, from the Accounting settings. */
export async function ledgerSettings(files) {
  const settings = await readSettings(files, accounting.settingsPath, 'Accounting')
  if (!/^[A-Z]{3}$/.test(settings.baseCurrency ?? '')) fail(`Set the base currency in Accounting settings (${accounting.settingsPath}) before posting.`)
  const digits = Number.isInteger(settings.minorDigits) && settings.minorDigits >= 0 && settings.minorDigits <= 4 ? settings.minorDigits : 2
  return { ...settings, minorDigits: digits }
}

/** The open accounting period whose dates contain `date`. */
export async function openPeriodFor(files, date) {
  if (!sameDate.test(date ?? '')) fail('A posting date (YYYY-MM-DD) is required.')
  const periods = await readFolder(files, accounting.periods, accounting.mime('period'), 'period')
  const covering = periods.filter(({ record }) => record.state !== 'archived' && record.startDate <= date && date <= record.endDate)
  const open = covering.find(({ record }) => record.status === 'open')
  if (open) return { path: open.path }
  if (covering.length) fail(`The accounting period covering ${date} (${covering[0].record.name || covering[0].name}) is closed.`)
  return fail(`No accounting period covers ${date}. Create one in ${accounting.periods}.`)
}

/** Reads and checks the accounts posting lines use: each must be an active account. */
export async function readAccounts(files, paths) {
  const accounts = {}
  for (const path of new Set(paths)) {
    if (typeof path !== 'string' || !path.startsWith(`${accounting.accounts}/`)) fail(`Choose an account from ${accounting.accounts} (got ${JSON.stringify(path ?? '')}).`)
    let record
    try {
      record = await files.readJson(path)
    } catch (error) {
      if (statusOf(error) === 404) fail(`Account ${path} does not exist.`)
      throw error
    }
    if (record?.kind !== 'account') fail(`${path} is not an account.`)
    if (record.state === 'archived') fail(`Account ${record.code || path} is archived.`)
    accounts[path] = record
  }
  return accounts
}

/**
 * Validates journal lines (accounts, directions, positive amounts) and returns their exact totals.
 * Debits must equal credits and be non-zero.
 */
export function balanceLines(lines, digits) {
  if (!Array.isArray(lines) || lines.length < 2) fail('A journal needs at least two lines.')
  let debit = 0n
  let credit = 0n
  lines.forEach((line, index) => {
    const amount = toMinor(line.amount, digits, `Line ${index + 1} amount`)
    if (amount === 0n) fail(`Line ${index + 1} has no amount.`)
    if (line.direction === 'debit') debit += amount
    else if (line.direction === 'credit') credit += amount
    else fail(`Line ${index + 1} must be a debit or a credit.`)
  })
  if (debit !== credit) fail(`Debits (${formatMinor(debit, digits)}) and credits (${formatMinor(credit, digits)}) do not balance.`)
  return { debit, credit }
}

export const journalLine = (account, direction, minor, digits, description = '') =>
  ({ account, direction, amount: formatMinor(minor, digits), ...(description ? { description } : {}) })

/** A posted journal derived from a source record (an expense, invoice, credit note or payment). */
export function postedJournal({ code, date, description, currency, period, lines, source, now, id }) {
  return {
    $schema: accounting.schema('journal'), schemaVersion: 1, kind: 'journal', id, state: 'active',
    createdAt: now, updatedAt: now, code, date, description, currency, period: { path: period },
    lines, status: 'posted', postedAt: now, ...(source ? { source: { path: source } } : {}),
  }
}

/** The journal that reverses `journal`: every line flipped, dated and posted in the period containing `date`. */
export function reversalJournal(original, { code, path, date, period, reason, now, id }) {
  return {
    $schema: accounting.schema('journal'), schemaVersion: 1, kind: 'journal', id, state: 'active',
    createdAt: now, updatedAt: now, code, date,
    description: `Reversal of ${original.code || nameOf(path)}${reason ? `: ${reason}` : ''}`,
    currency: original.currency, period: { path: period },
    lines: original.lines.map(line => ({ ...line, direction: line.direction === 'debit' ? 'credit' : 'debit' })),
    status: 'posted', postedAt: now, reversalOf: { path },
    ...(original.source ? { source: original.source } : {}),
  }
}

/**
 * Creates a derived journal create-only under a deterministic name. If an earlier, interrupted attempt already
 * wrote it (same `link` field pointing at the same record), the existing journal is kept: retrying an
 * operation never posts twice.
 */
export async function createJournal(files, path, journal, link) {
  try {
    await files.write(path, JSON.stringify(journal, null, 2), { contentType: accounting.mime('journal'), ifNoneMatch: '*' })
    return { path, created: true }
  } catch (error) {
    if (statusOf(error) !== 412) throw error
  }
  const existing = await files.readJson(path)
  if (existing?.kind !== 'journal' || existing[link]?.path !== journal[link].path) {
    fail(`${path} already exists and belongs to something else. Rename it and try again.`)
  }
  const amounts = lines => JSON.stringify((lines ?? []).map(({ account, direction, amount }) => [account, direction, amount]))
  if (amounts(existing.lines) !== amounts(journal.lines)) {
    fail(`${path} was posted by an earlier attempt with different amounts. Check it against ${journal[link].path} before trying again.`)
  }
  return { path, created: false }
}

/** Posts the reversal of a posted journal and links the original to it. */
export async function reverseJournal(files, journalPath, { date, reason, now, uuid, suffix = '-R' }) {
  const original = await readRecord(files, journalPath, 'journal')
  if (original.record.status !== 'posted') fail(`${original.record.code || journalPath} is not posted.`)
  if (original.record.reversalOf) fail(`${original.record.code || journalPath} is itself a reversal.`)
  const reversalPath = original.record.reversedBy?.path ?? `${journalPath}${suffix}`
  const period = await openPeriodFor(files, date)
  const reversal = reversalJournal(original.record, {
    code: nameOf(reversalPath), path: journalPath, date, period: period.path, reason, now, id: uuid(),
  })
  await createJournal(files, reversalPath, reversal, 'reversalOf')
  if (!original.record.reversedBy) {
    original.record.reversedBy = { path: reversalPath }
    original.record.reversedAt = now
    original.record.updatedAt = now
    await saveRecord(files, original, accounting.mime('journal'))
  }
  return reversalPath
}

/**
 * What Accounting's `post-journal` operation needs to post a record's journal (through its API, from the record's form);
 * the record names the journal (`/journals/EXP-0001`). Apps never write /journals themselves.
 */
export function journalRequest(path, date, description, currency, lines) {
  return { source: { path, code: nameOf(path) }, date, description, currency, lines }
}

/** The journal Accounting posted for a record: named after it, sourced from it and posted. */
export async function postedJournalFor(files, path, journalPath) {
  if (journalPath !== `${accounting.journals}/${nameOf(path)}`) fail('Accounting returned another journal.')
  const posted = await readRecord(files, journalPath, 'journal')
  if (posted.record.source?.path !== path || posted.record.status !== 'posted') fail(`${nameOf(journalPath)} is not this record's posted journal.`)
  return journalPath
}
