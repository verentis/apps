import { randomUUID } from 'node:crypto'
import { divideHalfUp, formatMinor, ledgerSettings, parseDecimal, readRecord, statusOf, toMinor } from './ledger.mjs'
import { check, customer, digest, direct, has, register, save, signature, strong, uuidPattern } from './common.mjs'

function eligible(m) {
  check(m.status === 'open' && ['clear','waiver-reviewed'].includes(m.decision?.outcome) &&
    m.decision.signature === signature(m), 'An opened matter with unchanged reviewed engagement terms is required.')
}
async function source(files, path, root, kind) {
  const r = await readRecord(files, direct(path, root), kind)
  check(strong(r.etag) && r.record.state === 'active' && uuidPattern.test(r.record.id), 'Active source with stable ID and ETag required.')
  return r
}
async function quote(files, current) {
  const m = current.record
  eligible(m)
  check(has(m.billingReviewer) && m.charges.length > 0 && m.charges.length <= 100, 'Name the approver and select 1–100 charges.')
  const { baseCurrency, minorDigits: digits } = await ledgerSettings(files)
  check(baseCurrency === m.currency, 'Matter and Accounting currency must match. No conversion is supported.')
  const config = await files.readJson('/settings/invoicing.json')
  check(Number.isInteger(config.defaultDueDays) && config.defaultDueDays >= 0 && config.defaultDueDays <= 365, 'Set Invoicing due days first.')
  const taxRate = config.defaultTaxRate || '0'
  parseDecimal(taxRate, 'Invoicing default tax rate', 4)
  const clientRef = m.parties.find(p => p.role === 'client').crm
  const client = await customer(files, clientRef)
  const rows = [], seen = new Set()
  for (const c of m.charges) {
    check(has(c.release) && c.release.length <= 500, 'Enter a client-safe narrative for every charge. Private source text is not copied.')
    let path, id, version, rate, quantity = '1', date = '', employee = ''
    if (c.source === 'time') {
      const { record: t, etag } = await source(files, c.path, '/timesheets', 'entry')
      check(t.status === 'validated' && has(t.validatedAt) && has(m.project) && t.project === m.project, 'Time must be validated against this matter’s project.')
      const agreed = m.rates.filter(r => r.employee === t.employee && r.effective <= t.date).sort((a,b) => b.effective.localeCompare(a.effective))[0]
      check(agreed && /^\d{4}-\d{2}-\d{2}$/.test(t.date), 'No agreed rate for this employee and work date.')
      path = c.path; id = t.id; version = etag; rate = agreed.amount; quantity = t.hours; date = t.date; employee = t.employee
    } else if (c.source === 'recoverable-expense') {
      const { record: e, etag } = await source(files, c.path, '/expense-reports', 'report')
      check(['approved','posted'].includes(e.status) && has(e.approvedAt) && has(e.approver) && has(c.recoverability),
        'An approved expense and a separate client-recoverability justification are required.')
      check(e.lines?.length === 1 && toMinor(e.total, digits) === toMinor(e.lines[0].amount, digits),
        'Use a dedicated approved single-line report for this matter. Mixed employee reimbursements cannot be billed.')
      path = c.path; id = e.id; version = etag; rate = e.total; date = e.lines[0].date
    } else {
      check(c.source === 'fixed-fee' && !c.path && m.fixedFee, 'Choose time, a recoverable expense or the agreed one-off fixed fee.')
      path = current.path; id = m.id; version = m.decision.signature; rate = m.fixedFee
    }
    const keys = [`${c.source}:id:${id.toLowerCase()}`, `${c.source}:path:${path.toLowerCase()}`]
    for (const key of keys) { check(!seen.has(key), 'The same source is selected twice.'); seen.add(key) }
    const q = parseDecimal(quantity, 'Quantity', 6)
    const unit = toMinor(rate, digits)
    const gross = divideHalfUp(q.units * unit, 10n ** BigInt(q.scale))
    const reduction = toMinor(c.writeDown || '0', digits)
    check(gross > reduction && (!reduction || has(c.reason)), 'Write-downs require a reason and must leave a positive charge.')
    const net = formatMinor(gross - reduction, digits)
    toMinor(net, digits, 'Charge total')
    rows.push({ keys, path, id, version, quantity, rate, date, employee, total: formatMinor(gross, digits), writeDown: formatMinor(reduction, digits),
      reason: c.reason, recoverability: c.recoverability, net, line: { description: c.release.trim(),
        quantity: reduction ? '1' : quantity, unitPrice: reduction ? net : formatMinor(unit, digits), taxRate } })
  }
  return { clientRef, client, currency: baseCurrency, dueDays: config.defaultDueDays, reviewer: m.billingReviewer, rows }
}
async function book(files) {
  const r = await readRecord(files, register)
  check(strong(r.etag) && r.record.version === 1 && Array.isArray(r.record.batches), 'Billing register missing, unrecognised or lacks ETag; reconcile before billing.')
  return r
}
async function persist(files, r) {
  await files.write(register, JSON.stringify(r.record), { contentType: 'application/json', ifMatch: r.etag })
}
/**
 * What Invoicing needs to draft the approved batch (its `create-draft-invoice` operation). The batch id keys the
 * source, so asking again for the same batch returns the same draft. Legal Matters never writes Invoicing's files.
 */
export function invoiceRequest(batch, matterPath) {
  const { id, at, quote: q } = batch
  const due = new Date(at)
  due.setUTCDate(due.getUTCDate() + q.dueDays)
  return { source: { path: `${matterPath}#prebill-${id}`, code: `LM-${id}` }, currency: q.currency,
    ...(q.clientRef ? { customerRef: q.clientRef } : {}), customer: q.client, lines: q.rows.map(r => r.line),
    issueDate: at.slice(0, 10), dueDate: due.toISOString().slice(0, 10) }
}
async function dispatch(files, current, now) {
  const m = current.record, p = m.prebill
  const reg = await book(files)
  let batch = reg.record.batches.find(b => b.id === p.id)
  if (!batch) {
    const keys = new Set(p.quote.rows.flatMap(line => line.keys))
    const collision = reg.record.batches.some(b => b.quote.rows.some(line => line.keys.some(k => keys.has(k))))
    if (collision) {
      delete m.prebill
      await save(files, current, now, 'Pre-bill rejected · source already reserved')
      throw new Error('A source is already reserved. No draft was created for this pre-bill; remove billed sources.')
    }
    // Reserve the entire batch in ONE conditional workspace write before asking Invoicing.
    batch = { id: p.id, matter: m.id, at: p.approvedAt, quote: p.quote, delivered: false }
    reg.record.batches.push(batch)
    await persist(files, reg)
  }
  check(batch.matter === m.id && digest(batch.quote) === digest(p.quote), 'Reservation mismatch; reconcile manually.')
  // The workflow asks Invoicing to draft it (through the platform, in the same run), then `record-invoice` marks the batch delivered.
  // `revision` lets the form record the invoice against the matter as it now stands.
  return { message: 'Pre-bill approved; Invoicing drafts the invoice.', invoiceRequest: invoiceRequest(batch, current.path), revision: m.revision }
}
/** Records the invoice Invoicing drafted for the approved batch: the batch is delivered and the pre-bill closes. */
async function deliver(files, current, invoicePath, now) {
  const m = current.record, p = m.prebill
  check(p?.stage === 'pending', 'No approved pre-bill is waiting for its invoice.')
  check(typeof invoicePath === 'string' && invoicePath.startsWith('/invoices/'), 'Invoicing returned no invoice.')
  const latest = await book(files)
  const reserved = latest.record.batches.find(b => b.id === p.id)
  check(reserved && reserved.matter === m.id && digest(reserved.quote) === digest(p.quote), 'Register changed unexpectedly; reconcile manually.')
  if (!reserved.delivered) { Object.assign(reserved, { delivered: true, invoice: invoicePath }); await persist(files, latest) }
  if (!m.invoices.includes(invoicePath)) m.invoices.push(invoicePath)
  delete m.prebill
  m.charges = []
  await save(files, current, now, `Approved draft · ${invoicePath} · ${reserved.quote.reviewer}`)
  return { message: `Draft ready in Invoicing: ${invoicePath}`, path: invoicePath }
}
export async function billing(files, current, operation, now, invoicePath) {
  const m = current.record
  eligible(m)
  if (operation === 'prepare') {
    check(!m.prebill, 'A pre-bill is already in progress.')
    m.prebill = { id: randomUUID(), stage: 'review', quote: await quote(files, current) }
    await save(files, current, now, 'Pre-bill prepared for review')
    return { message: 'Review the pre-bill before approval.' }
  }
  if (operation === 'discard') {
    check(m.prebill?.stage === 'review', 'Only an unapproved pre-bill can be discarded.')
    delete m.prebill
    await save(files, current, now, 'Pre-bill discarded')
    return { message: 'Pre-bill discarded.' }
  }
  if (operation === 'record-invoice') return deliver(files, current, invoicePath, now)
  check(operation === 'approve' && ['review','pending'].includes(m.prebill?.stage), 'Prepare a pre-bill first.')
  if (m.prebill.stage === 'review') {
    check(digest(await quote(files, current)) === digest(m.prebill.quote), 'Source, terms or invoice settings changed. Discard and prepare a fresh pre-bill.')
    m.prebill.stage = 'pending'; m.prebill.approvedAt = now
    await save(files, current, now, 'Pre-bill approved; dispatch pending')
    const fresh = await readRecord(files, current.path, 'matter')
    check(strong(fresh.etag) && fresh.record.prebill?.id === m.prebill.id && fresh.record.prebill.stage === 'pending', 'Matter changed. Reload before retry.')
    return dispatch(files, fresh, now)
  }
  return dispatch(files, current, now)
}
