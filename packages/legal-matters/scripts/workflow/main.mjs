import { randomUUID } from 'node:crypto'
import { check, gate, load, matters, mime, save } from './common.mjs'
import { intake } from './intake.mjs'
import { billing } from './billing.mjs'
import { editable, initial } from './initial.mjs'
import { handOver } from './app-calls.mjs'

// The guarded form accepts only the editable schema subset, never lifecycle, reservations or invoice references.
function accepted(value, shape) {
  if (shape.enum) return shape.enum.includes(value)
  if (shape.type === 'string') return typeof value === 'string' && value.length <= (shape.maxLength ?? 1000) &&
    (!shape.pattern || new RegExp(shape.pattern).test(value))
  if (shape.type === 'array') return Array.isArray(value) && value.length <= shape.maxItems && value.every(v => accepted(v,shape.items))
  return shape.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => Object.hasOwn(shape.properties,k)) && shape.required.every(k => accepted(value[k],shape.properties[k]))
}

export async function run(engine) {
  gate(engine)
  const { parameters: p } = engine.context.input
  const files = engine.files, now = new Date().toISOString()
  if (p?.operation === 'create') {
    check(p.parentPath === matters && (p.branch ?? 'main') === 'main' && p.creatable === 'matter', 'Create only inside /legal-matters on main.')
    const id = randomUUID(), code = `MAT-${id}`, path = `${matters}/${code}`
    // Do not grant callers a write-any-JSON primitive via their supplied template, name or destination.
    const record = { ...structuredClone(initial), id, code, revision:id, createdAt: now, updatedAt: now, title: 'New matter' }
    await files.write(path, JSON.stringify(record), { contentType: mime, ifNoneMatch: '*' })
    return { path }
  }
  check(['save','screen','decide','prepare','discard','approve','record-invoice'].includes(p?.operation), 'Unsupported Legal Matters operation.')
  const current = await load(files, p.path)
  check(p.revision && p.revision === current.record.revision,'Matter changed since it was opened. Reload before continuing.')
  if (p.operation === 'save') {
    const m = current.record
    check(m.status !== 'declined' && !m.prebill,'This matter or pre-bill is locked.')
    const allowed = ['team','links', ...(m.status === 'open' ? ['charges','billingReviewer'] :
      ['title','parties','project','engagement','currency','rates','fixedFee','reviewBy','disposition','reviewReason'])]
    for (const key of allowed) {
      check(accepted(p.values?.[key],editable[key]),`Invalid ${key}.`)
      m[key] = p.values[key]
    }
    await save(files,current,now)
    return {message:'Saved matter.'}
  }
  return ['screen','decide'].includes(p.operation) ? intake(files, current, p.operation, now) : billing(files, current, p.operation, now, p.invoice)
}
/** The same run with other parameters (the record step after a hand-over), keeping the engine's clients. */
const withParameters = (engine, parameters) => Object.create(engine, {
  context: { value: { ...engine.context, input: { ...engine.context.input, parameters } } },
})

/**
 * Approving a pre-bill hands its invoice request to Invoicing (`create-draft-invoice`, through the platform as the same
 * user) and records the draft against the matter's new revision, in this run. Without Invoicing the pre-bill waits,
 * approved.
 */
export async function runWithApps(engine) {
  const result = await run(engine)
  const p = engine.context.input.parameters
  if (p?.operation !== 'approve') return result
  return handOver(engine.apps, result, {
    app: 'invoicing', operation: 'create-draft-invoice', field: 'invoiceRequest', key: `prebill-${String(p.path ?? '').split('/').pop()}`,
    record: invoice => run(withParameters(engine, { ...p, operation: 'record-invoice', invoice, revision: result.revision })),
  })
}
export default async function workflow(engine) { await engine.output.result(await runWithApps(engine)) }
