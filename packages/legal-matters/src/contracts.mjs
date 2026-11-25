import { array, code, object, optional, optionalDate, money, pathOrEmpty, schemas } from '../../../tools/file-apps/schema.mjs'

export const root = '/applications/legal-matters'
export const matters = '/legal-matters'
export const register = '/legal-billing-register'
export const mime = 'application/vnd.verentis.legal-matters.matter+json'
export const folderMime = 'application/vnd.verentis.legal-matters.matters'
const kit = schemas('https://schemas.verentis.io/legal-matters/v1', 'Legal Matters')
const party = object({ role: { enum: ['client', 'counterparty', 'related'] }, name: optional(200), crm: pathOrEmpty, aliases: optional(1000) })
const rate = object({ employee: optional(200), effective: optionalDate, amount: money })
const charge = object({
  source: { enum: ['time', 'recoverable-expense', 'fixed-fee'] }, path: pathOrEmpty, release: optional(500),
  writeDown: money, reason: optional(500), recoverability: optional(500),
})
const defaults = {
  revision: '{{ id }}', title: '{{ name }}', status: 'intake', parties: [], team: [], links: [],
  project: '', engagement: '', currency: 'ZAR', rates: [], fixedFee: '', reviewBy: '', reviewReason: '',
  disposition: 'undecided', charges: [], billingReviewer: '', chronology: [], invoices: [],
}
export const template = kit.recordTemplate('matter', defaults)
export const schema = kit.recordSchema('matter', 'matter', {
  code, revision: {type:'string',format:'uuid'},
  // Set on matters created during the synthetic pilot; no longer written or required.
  pilot: { type: 'string', maxLength: 40 },
  title: optional(200), status: { enum: ['intake', 'screened', 'declined', 'open'] },
  parties: array(party, 0, 100), team: array(optional(200), 0, 100),
  links: array(object({ kind: { enum: ['document', 'task', 'deadline'] }, description: optional(500), path: pathOrEmpty, date: optionalDate }), 0, 200),
  project: pathOrEmpty, engagement: optional(5000), currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  rates: array(rate, 0, 100), fixedFee: money, reviewBy: optional(200), reviewReason: optional(2000),
  disposition: { enum: ['undecided', 'clear', 'waiver-reviewed', 'decline'] },
  charges: array(charge, 0, 100), billingReviewer: optional(200),
  chronology: array(optional(1000)), invoices: array(pathOrEmpty),
  screen: object({ fingerprint: optional(64), count: { type: 'integer', minimum: 0 }, at: optional(40) }),
  decision: object({ signature: optional(64), by: optional(200), reason: optional(2000), at: optional(40), outcome: optional(40) }),
  prebill: { type: 'object' },
}, ['code', ...Object.keys(defaults)])
