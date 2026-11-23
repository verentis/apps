import { toMinor } from './ledger.mjs'
import { check, customer, digest, direct, has, matters, mime, save, signature } from './common.mjs'

const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const keys = parties => new Set(parties.flatMap(p => [
  ...[p.name, ...(p.aliases || '').split(';')].map(norm).filter(Boolean).map(n => `name:${n}`),
  ...(p.crm ? [`crm:${p.crm.toLowerCase()}`] : []),
]))
async function screen(files, current) {
  const m = current.record
  check(has(m.title) && Array.isArray(m.parties) && m.parties.length > 0 && m.parties.length <= 100 &&
    m.parties.every(p => ['client','counterparty','related'].includes(p.role) && has(p.name)) &&
    m.parties.filter(p => p.role === 'client').length === 1, 'Enter a title, exactly one client, and every party name and role.')
  for (const p of m.parties) if (p.crm || p.role === 'client') await customer(files, p.crm)
  const ours = keys(m.parties)
  const signals = []
  for (let number = 1; ; number++) {
    const response = await files.list(matters,100,number)
    const page = response?.children ?? response
    check(Array.isArray(page?.data) && Number.isSafeInteger(page.pageCount) && page.pageCount >= 0 &&
      page.pageCount <= 20 && (page.pageNumber === undefined || page.pageNumber === number),
    'Unexpected or oversized matter listing; cannot complete the pilot screen.')
    for (const child of page.data) {
      const path = direct(child.path ?? `${matters}/${child.name}`,matters)
      if (path === current.path || (child.mimeType && child.mimeType !== mime)) continue
      const other = await files.readJson(path)
      check(other.kind === 'matter' && other.pilot === 'synthetic-only' && Array.isArray(other.parties), 'Cannot screen an unexpected matter file.')
      const overlap = [...keys(other.parties)].filter(key => ours.has(key)).sort()
      if (overlap.length) signals.push(digest([other.id, overlap]))
    }
    if (number >= page.pageCount) break
  }
  return { count: signals.length, fingerprint: digest([m.parties, signals.sort()]) }
}
export async function intake(files, current, operation, now) {
  const m = current.record
  check(['intake', 'screened'].includes(m.status), 'This intake has already been decided.')
  const result = await screen(files, current)
  if (operation === 'screen') {
    Object.assign(m, { screen: { ...result, at: now }, status: 'screened', disposition: 'undecided', reviewReason: '' })
    await save(files, current, now, `Screened · ${result.count} potential matching matters`)
    return { message: `${result.count} potential matching matters; human review required.` }
  }
  check(m.status === 'screened' && m.screen?.fingerprint === result.fingerprint, 'Party list or potential matches changed. Screen again.')
  check(has(m.reviewBy) && has(m.reviewReason) && ['clear','waiver-reviewed','decline'].includes(m.disposition),
    'Record the reviewer, disposition and reasons.')
  if (m.disposition !== 'decline') {
    check(result.count === 0 || m.disposition === 'waiver-reviewed', 'A potential match requires explicit waiver review or decline.')
    check(has(m.engagement) && /^[A-Z]{3}$/.test(m.currency) && (m.rates.length || m.fixedFee), 'Record the engagement and agreed fee terms.')
    if (m.project || m.rates.length) {
      const project = await files.readJson(direct(m.project, '/projects'))
      check(project.kind === 'project' && project.state === 'active', 'Select an active Project record for hourly work.')
    }
    const seen = new Set()
    for (const r of m.rates) {
      const key = JSON.stringify([r.employee,r.effective])
      check(!seen.has(key) && has(r.employee) && /^\d{4}-\d{2}-\d{2}$/.test(r.effective) && toMinor(r.amount, 4) > 0n, 'Each employee/effective date needs one positive agreed rate.')
      seen.add(key)
    }
    if (m.fixedFee) check(toMinor(m.fixedFee, 4) > 0n, 'Fixed fee must be positive.')
  }
  m.decision = { signature: signature(m), by: m.reviewBy, reason: m.reviewReason, at: now, outcome: m.disposition }
  m.status = m.disposition === 'decline' ? 'declined' : 'open'
  await save(files, current, now, `${m.status} · ${m.reviewBy}`)
  return { message: `Matter ${m.status}` }
}
