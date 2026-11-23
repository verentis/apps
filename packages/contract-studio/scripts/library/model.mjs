// Generated from scripts/draft/model.mjs by src/build.mjs.
import { createHash } from 'node:crypto'

export const root = '/applications/contract-studio'
export const contracts = '/legal-contracts'
export const precedents = '/legal-precedents'
export const clients = '/legal-client-documents'
export const schedules = '/legal-source-schedules'
export const catalog = '/applications/legal-research/catalog/authorities.json'
export const packs = '/legal-authority-packs'
export const mime = kind => `application/vnd.verentis.contract-studio.${kind}+json`
export const officeMime = 'application/vnd.oasis.opendocument.text-flat-xml'
export const schemaId = 'https://schemas.verentis.io/contract-studio/v1/contract.schema.json'
export const digest = text => createHash('sha256').update(text, 'utf8').digest('hex')
export function assert(ok, message) { if (!ok) throw new Error(message) }
export function string(value, label, max = 12000, optional = false) {
  assert(typeof value === 'string' && value.length <= max && (optional || value.trim()), `Enter a valid ${label} (maximum ${max} characters).`)
  return value.trim()
}
export function key(value, label = 'identifier') {
  assert(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value), `Invalid ${label}: use letters, numbers, hyphens or underscores.`)
  return value
}
export function child(path, parent) {
  assert(typeof path === 'string' && path.startsWith(`${parent}/`), `Select a record in ${parent}.`)
  key(path.slice(parent.length + 1))
  return path
}
export function matter(value) { return value ? child(value, '/legal-matters') : '' }
export function revision(value) {
  const n = Number(value)
  assert(Number.isSafeInteger(n) && n >= 1 && n <= 999999, 'Revision must be a positive whole number (1–999999).')
  return n
}
export function libraryPath(code, rev) { return `${precedents}/${key(code)}-v${revision(rev)}` }
export function precedent(source) {
  assert(source?.kind === 'precedent', 'Not a firm precedent revision.')
  return {
    kind: 'precedent', code: key(source.code), revision: revision(source.revision),
    title: string(source.title, 'clause title', 200), wording: string(source.wording, 'approved wording'),
    jurisdiction: string(source.jurisdiction, 'jurisdiction', 120), intendedUse: string(source.intendedUse, 'intended use', 1000),
    approvedBy: string(source.approvedBy, 'approver', 160), approvedAt: string(source.approvedAt, 'approval date', 40),
  }
}
export function authority(source) {
  assert(source?.rights === 'link-only', 'Only link-only bibliographic authorities are supported.')
  const fields = Object.fromEntries(['id','jurisdiction','instrument','provision','citation','sourceUrl','revision','coverage']
    .map(name => [name, string(source[name], name, name === 'sourceUrl' ? 2000 : 500)]))
  const validUrl = value => {
    const url = new URL(string(value, 'source link', 2000))
    assert(url.protocol === 'https:' && !url.username && !url.password, 'The authority must link to an HTTPS source.')
    return value
  }
  validUrl(fields.sourceUrl)
  if (source.officialUrl) fields.officialUrl = validUrl(source.officialUrl)
  if (source.checkedThrough) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(source.checkedThrough), 'Invalid coverage verification date.')
    fields.checkedThrough = source.checkedThrough
  }
  return { ...fields, rights: 'link-only' }
}
export function catalogPath(path) { return !path || path === catalog ? catalog : child(path, packs) }
export function variables(value = '') {
  const result = Object.create(null)
  for (const line of string(value, 'bindings', 6000, true).split('\n').filter(s => s.trim())) {
    const at = line.indexOf('=')
    const name = line.slice(0, at).trim()
    assert(at > 0 && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) && !Object.hasOwn(result, name), 'Use one distinct name=value per line.')
    result[name] = string(line.slice(at + 1), `value for ${name}`, 500)
    assert(!/[{}]/.test(result[name]), 'Bindings must be literal values, not placeholders.')
  }
  return result
}

function renderPoint(point, indexes) {
  const isFirm = point.origin === 'firm'
  assert(isFirm || point.origin === 'inline', 'Unknown point origin.')
  const pinned = isFirm ? precedent(point.precedent) : null
  const wording = string(isFirm ? (point.variation || pinned.wording) : point.wording, 'point wording')
  const bindings = variables(point.bindings)
  const resolved = wording.replace(/\{\{(point:)?([A-Za-z0-9_-]+)\}\}/g, (_, ref, id) => {
    if (ref) { assert(indexes.has(id), `Broken point reference: ${id}`); return String(indexes.get(id)) }
    assert(Object.hasOwn(bindings, id), `Unresolved variable: ${id}`)
    return bindings[id]
  })
  assert(!/[{}]/.test(resolved), 'Unresolved or malformed placeholder in point wording.')
  const source = point.authority
  const citation = source ? { ...authority(source), catalog: catalogPath(source.catalog),
    pinpoint: string(source.pinpoint, 'pinpoint', 200), retrievedAt: string(source.retrievedAt, 'retrieval date', 40),
    effectiveDateEvidence: 'Not verified; check commencement and amendments.' } : null
  return { number: indexes.get(point.id), id: point.id, origin: point.origin, wording: resolved,
    template: wording, bindings, precedent: pinned, localVariation: isFirm && !!point.variation,
    citation, internalNote: string(point.note || '', 'internal note', 2000, true),
    sourceDecision: point.sourceDecision || null }
}

export function render(contract) {
  const title = string(contract.title, 'contract title', 200)
  assert(Array.isArray(contract.points) && contract.points.length > 0 && contract.points.length <= 100, 'An agreement needs 1–100 points.')
  const indexes = new Map(contract.points.map((p, i) => [key(p.id, 'point ID'), i + 1]))
  assert(indexes.size === contract.points.length, 'Point IDs must be unique.')
  const points = contract.points.map(point => renderPoint(point, indexes))
  const client = `${title}\n\n${points.map(p => `${p.number}. ${p.wording}`).join('\n\n')}\n`.replace(/\r\n?/g, '\n')
  assert(!/[^\u0009\u000A\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(client), 'Client wording contains a character not permitted in an Office document.')
  return { client, points }
}

function flatOdt(client) {
  const escapeLine = line => line.replace(/&|<|>|\t|^ +| +$| {2,}/g, match => {
    if (match[0] === ' ') return `<text:s text:c="${match.length}"/>`
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '\t':'<text:tab/>' }[match]
  })
  const paragraphs = client.split('\n').map(line => `<text:p>${escapeLine(line)}</text:p>`).join('\n')
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">\n' +
    `<office:body><office:text>\n${paragraphs}\n</office:text></office:body>\n</office:document>\n`
}

export function freeze(contract, reviewer, now) {
  const { client, points } = render(contract)
  const office = flatOdt(client)
  const clientSha256 = digest(client)
  const officeSha256 = digest(office)
  const schedule = JSON.stringify({ classification: 'Internal source schedule — not for client distribution',
    contract: key(contract.code), title: contract.title, matter: matter(contract.matter),
    approvedBy: string(reviewer, 'reviewer', 160), approvedAt: now, clientSha256, officeSha256, points }, null, 2) + '\n'
  return { client, clientSha256, office, officeSha256, schedule, scheduleSha256: digest(schedule) }
}
