// Moves Field Service tasks through their stages. Canvas task forms run this script (run-script) against a saved
// task; it enforces the transitions (new → scheduled → on-site → done, open stages → cancelled), requires a date
// and technician to schedule and positive hours to complete, computes the materials total in exact minor units
// (BigInt, never floats) and updates the task conditionally (If-Match), so a concurrent edit fails instead of
// being overwritten.
//
// Integrity model: when Invoicing is installed (its /invoices container exists), completing drafts an invoice
// under the task's own code, create-only (If-None-Match: *), so a retried completion never drafts twice; a run
// interrupted between the invoice draft and the task update completes on retry. Re-running a finished operation
// returns a friendly message instead of failing.
import { randomUUID } from 'node:crypto'

export const operations = ['schedule', 'start', 'complete', 'cancel']
export const fieldService = {
  tasks: '/field-tasks',
  mime: 'application/vnd.verentis.field-service.task+json',
}
/** Invoicing's public file contract: completing a task drafts an invoice here when the container exists. */
export const invoicing = {
  invoices: '/invoices',
  invoiceMime: 'application/vnd.verentis.invoicing.invoice+json',
  invoiceSchemaId: 'https://schemas.verentis.io/invoicing/v1/invoice.schema.json',
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

/** A draft invoice for the completed task, in Invoicing's vendor MIME: a labour line plus the materials. */
export function draftInvoice(record, { now, uuid }) {
  const emptyParty = { name: '', legalName: '', email: '', phone: '', taxIdentifier: '', address: { lines: [], city: '', region: '', postalCode: '', country: '' } }
  return {
    $schema: invoicing.invoiceSchemaId, schemaVersion: 1, kind: 'invoice', id: uuid(), state: 'active',
    createdAt: now, updatedAt: now, code: record.code, issueDate: '', dueDate: '', currency: '',
    reference: `Field task ${record.code}`, customerRef: record.customerRef || '',
    customer: { ...emptyParty, name: record.customerName || '' },
    lines: [
      { description: `Labour — ${record.hours} h on site`, quantity: record.hours, unitPrice: '', taxRate: '' },
      ...(record.materials ?? []).filter(material => String(material?.quantity ?? '').trim() || String(material?.unitPrice ?? '').trim())
        .map(material => ({ description: material.description || '', quantity: material.quantity || '0', unitPrice: material.unitPrice || '', taxRate: '' })),
    ],
    notes: `Drafted from Field Service task ${record.code}.`,
    status: 'draft',
  }
}

/**
 * on-site → done: checks the hours, computes the materials total, drafts an invoice when Invoicing's /invoices
 * container exists (create-only under the task's code, so retries never draft twice), stamps completedAt and locks.
 */
export async function completeTask(files, path, { now, uuid }) {
  const task = await readTask(files, path)
  const { record } = task
  if (record.stage === 'done') return { message: `${label(record)} is already done`, path }
  if (record.stage !== 'on-site') fail(`${label(record)} is ${record.stage ?? 'in no stage'}; only on-site tasks can be completed.`)
  record.hours = checkHours(record.hours, record)
  record.materialsTotal = materialsTotal(record.materials, record)
  let invoicePath = ''
  if (await files.stat(invoicing.invoices)) {
    invoicePath = `${invoicing.invoices}/${record.code}`
    try {
      await files.write(invoicePath, JSON.stringify(draftInvoice(record, { now, uuid }), null, 2),
        { contentType: invoicing.invoiceMime, ifNoneMatch: '*' })
    } catch (error) {
      if (statusOf(error) !== 412) throw error
      // A file already exists under this task's code: accept it only when it is this task's own draft
      // from an earlier, interrupted run — never silently link an unrelated invoice.
      let existing
      try {
        existing = await files.readJson(invoicePath)
      } catch {
        existing = undefined
      }
      if (existing?.notes !== `Drafted from Field Service task ${record.code}.`) {
        fail(`Invoice ${invoicePath} already exists and was not drafted from ${label(record)}; move it aside or change the task code, then complete again.`)
      }
    }
  }
  Object.assign(record, { stage: 'done', completedAt: now, updatedAt: now, ...(invoicePath ? { invoice: invoicePath } : {}) })
  await saveTask(files, task)
  const invoiced = invoicePath ? ` and drafted invoice ${record.code}` : ''
  return { message: `Completed ${label(record)} (materials ${record.materialsTotal})${invoiced}`, path }
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

export async function run(parameters, files, { now = nowIso(), uuid = randomUUID } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now, uuid }
  if (operation === 'schedule') return scheduleTask(files, path, options)
  if (operation === 'start') return startTask(files, path, options)
  if (operation === 'complete') return completeTask(files, path, options)
  if (operation === 'cancel') return cancelTask(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
