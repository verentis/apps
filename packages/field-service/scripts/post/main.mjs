// Moves Field Service tasks through their stages. Canvas task forms run this script (run-script) against a saved
// task; it enforces the transitions (new → scheduled → on-site → done, open stages → cancelled), requires a date
// and technician to schedule and positive hours to complete, computes the materials total in exact minor units
// (BigInt, never floats) and updates the task conditionally (If-Match), so a concurrent edit fails instead of
// being overwritten.
//
// Completing returns what Invoicing needs to draft the invoice; the form or board asks Invoicing through the
// platform (Invoicing returns the same draft when asked again) and `record-invoice` stores the link. Field Service
// never writes Invoicing's files. Re-running a finished operation returns a friendly message instead of failing.

export const operations = ['schedule', 'start', 'complete', 'cancel', 'record-invoice']
export const fieldService = {
  tasks: '/field-tasks',
  mime: 'application/vnd.verentis.field-service.task+json',
}
/** The stages a task can be cancelled from. */
export const cancellableStages = ['new', 'scheduled', 'on-site']

class FieldServiceError extends Error {}
export const fail = message => { throw new FieldServiceError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This task'
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const decimalPattern = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/
const moneyPattern = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?$/

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${fieldService.tasks}/`) || path.slice(fieldService.tasks.length + 1).includes('/')) {
    fail(`Expected a task directly in ${fieldService.tasks} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** An exact decimal string as a BigInt scaled to `scale` fraction digits; empty is zero. */
function toScaled(value, scale) {
  const text = String(value ?? '').trim()
  if (!text) return 0n
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale))
}

/** A positive decimal-string number of hours; rejects numbers, zero, negatives and malformed text. */
export function checkHours(hours, record) {
  const text = typeof hours === 'string' ? hours.trim() : ''
  if (!decimalPattern.test(text)) fail(`${label(record)} needs hours as a positive decimal, e.g. 2.5 (got ${JSON.stringify(hours ?? '')}).`)
  if (!/[1-9]/.test(text)) fail(`${label(record)} has zero hours. Log the time spent on site before completing.`)
  return text
}

/**
 * The exact materials total as a two-decimal string: sum of quantity × unit price per material, computed in
 * BigInt ten-billionths (quantity scale 6 × price scale 4) and rounded half-up to cents.
 */
export function materialsTotal(materials, record) {
  let total = 0n
  for (const [index, material] of (Array.isArray(materials) ? materials : []).entries()) {
    const quantity = String(material?.quantity ?? '').trim()
    const price = String(material?.unitPrice ?? '').trim()
    if (!quantity && !price) continue
    if (!decimalPattern.test(quantity)) fail(`${label(record)} material ${index + 1} needs a decimal quantity (got ${JSON.stringify(material?.quantity ?? '')}).`)
    if (!moneyPattern.test(price)) fail(`${label(record)} material ${index + 1} needs a decimal unit price (got ${JSON.stringify(material?.unitPrice ?? '')}).`)
    total += toScaled(quantity, 6) * toScaled(price, 4)
  }
  // 10^10-scaled → cents, rounding half-up.
  const scale = 10n ** 8n
  const cents = total / scale + (total % scale >= scale / 2n ? 1n : 0n)
  const text = cents.toString().padStart(3, '0')
  return `${text.slice(0, -2)}.${text.slice(-2)}`
}

/** A task with the ETag it was read at, so the update can be conditional. */
async function readTask(files, path) {
  const metadata = await files.stat(checkPath(path))
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'task') fail(`${path} is not a field task.`)
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

/**
 * Writes the changed task back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveTask(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: fieldService.mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** new → scheduled, once the task has a date and a technician. */
export async function scheduleTask(files, path, { now }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage === 'scheduled') return { message: `${label(record)} is already scheduled`, path }
  if (record.stage !== 'new') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only new tasks can be scheduled.`)
  if (!datePattern.test(record.scheduledDate ?? '')) fail(`${label(record)} needs a scheduled date (YYYY-MM-DD) before it can be scheduled.`)
  if (!String(record.technician ?? '').trim()) fail(`${label(record)} needs a technician before it can be scheduled.`)
  Object.assign(record, { stage: 'scheduled', updatedAt: now })
  await saveTask(files, task)
  return { message: `Scheduled ${label(record)} for ${record.scheduledDate}`, path }
}

/** scheduled → on-site: the technician has arrived. */
export async function startTask(files, path, { now }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage === 'on-site') return { message: `${label(record)} is already on site`, path }
  if (record.stage !== 'scheduled') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only scheduled tasks can be started.`)
  Object.assign(record, { stage: 'on-site', updatedAt: now })
  await saveTask(files, task)
  return { message: `Started ${label(record)}`, path }
}

/**
 * What Invoicing needs to draft the completed task's invoice (its `create-draft-invoice` operation): a labour line
 * plus the materials. Rates and currency are completed in Invoicing. The task form (or board) asks Invoicing through
 * the platform; Field Service never writes Invoicing's files.
 */
export function invoiceRequest(path, record) {
  return {
    source: { path, code: record.code },
    reference: `Field task ${record.code}`,
    ...(record.customerRef ? { customerRef: record.customerRef } : {}),
    customer: { name: record.customerName || '' },
    lines: [
      { description: `Labour — ${record.hours} h on site`, quantity: record.hours, unitPrice: '' },
      ...(record.materials ?? []).filter(material => String(material?.quantity ?? '').trim() || String(material?.unitPrice ?? '').trim())
        .map(material => ({ description: material.description || 'Materials', quantity: material.quantity || '0', unitPrice: material.unitPrice || '' })),
    ],
    notes: `Drafted from Field Service task ${record.code}.`,
  }
}

/** Records the invoice Invoicing drafted for a completed task (the path its operation returned). */
export async function recordInvoice(files, path, invoicePath, { now }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage !== 'done') fail(`${label(record)} is not done.`)
  if (typeof invoicePath !== 'string' || !invoicePath.startsWith('/invoices/')) fail('Invoicing returned no invoice.')
  if (record.invoice === invoicePath) return { message: `${label(record)} already links ${invoicePath.split('/').pop()}`, path }
  Object.assign(record, { invoice: invoicePath, updatedAt: now })
  await saveTask(files, task)
  return { message: `Drafted invoice ${invoicePath.split('/').pop()} for ${label(record)}`, path }
}

/**
 * on-site → done: checks the hours, computes the materials total, drafts an invoice when Invoicing's /invoices
 * container exists (create-only under the task's code, so retries never draft twice), stamps completedAt and locks.
 */
export async function completeTask(files, path, { now }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage === 'done') {
    return { message: `${label(record)} is already done`, path, ...(record.invoice ? {} : { invoiceRequest: invoiceRequest(path, record) }) }
  }
  if (record.stage !== 'on-site') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only on-site tasks can be completed.`)
  record.hours = checkHours(record.hours, record)
  record.materialsTotal = materialsTotal(record.materials, record)
  Object.assign(record, { stage: 'done', completedAt: now, updatedAt: now })
  await saveTask(files, task)
  // The form asks Invoicing (when installed) to draft the invoice from this, then records the link.
  return { message: `Completed ${label(record)} (materials ${record.materialsTotal})`, path, invoiceRequest: invoiceRequest(path, record) }
}

/** new/scheduled/on-site → cancelled; the task form locks itself once cancelled. */
export async function cancelTask(files, path, { now }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage === 'cancelled') return { message: `${label(record)} is already cancelled`, path }
  if (!cancellableStages.includes(record.stage)) {
    fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only ${cancellableStages.join(', ')} tasks can be cancelled.`)
  }
  Object.assign(record, { stage: 'cancelled', cancelledAt: now, updatedAt: now })
  await saveTask(files, task)
  return { message: `Cancelled ${label(record)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'schedule') return scheduleTask(files, path, options)
  if (operation === 'start') return startTask(files, path, options)
  if (operation === 'complete') return completeTask(files, path, options)
  if (operation === 'cancel') return cancelTask(files, path, options)
  if (operation === 'record-invoice') return recordInvoice(files, path, parameters.invoice, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
