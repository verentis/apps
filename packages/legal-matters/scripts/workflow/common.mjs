import { createHash, randomUUID } from 'node:crypto'
import { fail, nameOf, readRecord, saveRecord } from './ledger.mjs'

export const matters = '/legal-matters'
export const mime = 'application/vnd.verentis.legal-matters.matter+json'
export const register = '/legal-billing-register'
export const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export const check = (condition, message) => { if (!condition) fail(message) }
export const has = value => typeof value === 'string' && !!value.trim()
export const strong = etag => has(etag) && !['*','""'].includes(etag.trim()) && !etag.startsWith('W/')
// Canvas may return equivalent form rows with a different property order.
export const digest = value => createHash('sha256').update(JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest('hex')
export function direct(path, parent) {
  check(typeof path === 'string' && path === `${parent}/${nameOf(path)}` && /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/.test(nameOf(path)), `Expected a direct record in ${parent}.`)
  return path
}
export function gate(engine) {
  const workspace = engine.context.workspace?.id
  check(uuidPattern.test(workspace || '') && engine.settings.get('synthetic-workspace-id') === workspace &&
    engine.settings.get('pilot-mode') === 'isolated-synthetic' && (engine.context.file?.branch ?? 'main') === 'main',
  'Disabled. Only the designated, isolated synthetic workspace on main can run Legal Matters. Never enter real client data.')
}
export async function load(files, path) {
  const current = await readRecord(files, direct(path, matters), 'matter')
  check(strong(current.etag) && current.record.pilot === 'synthetic-only' && current.record.state === 'active' &&
    uuidPattern.test(current.record.id), 'Active synthetic matter and VFS ETag required.')
  return current
}
export async function save(files, current, now, event) {
  current.record.updatedAt = now
  current.record.revision = randomUUID()
  if (event) current.record.chronology.push(`${now} · ${event}`)
  await saveRecord(files, current, mime)
}
export const signature = m => digest([m.title, m.parties, m.project, m.engagement, m.currency, m.rates, m.fixedFee,
  m.reviewBy, m.reviewReason, m.disposition])
export async function customer(files, path) {
  const crm = await files.readJson(direct(path, '/customers'))
  check(['company', 'contact'].includes(crm.kind) && crm.state === 'active', 'Choose an active CRM company or contact.')
  const name = crm.kind === 'company' ? crm.name : [crm.givenName, crm.familyName].filter(Boolean).join(' ')
  check(has(name), 'CRM party has no name.')
  return { name, legalName: crm.legalName || '' }
}
