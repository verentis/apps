// Invoicing's API script (see api.yaml): the operations other apps call through the platform. It runs with Invoicing's
// own file access; callers never write /invoices themselves.
import { createNumbered, fail, listRecords, serve, setting, stamp } from './runtime.mjs'
import config from './config.mjs'

/**
 * Drafts an invoice for another app's record, numbered like any new invoice. A draft already made for the same
 * calling app and source record is returned instead of a second one, so a retried call never invoices twice.
 */
export async function createDraftInvoice(input, { files, settings, caller, now }) {
  const app = String(caller?.app ?? '')
  if (!app) fail('The calling app is unknown.')
  const sourcePath = String(input.source?.path ?? '')
  const existing = (await listRecords(files, config.invoices))
    .find(({ record }) => record?.kind === 'invoice' && record.source?.app === app && record.source?.path === sourcePath)
  if (existing) return { path: existing.path, code: existing.record.code, created: false }
  const prefix = setting(settings, config.prefix.key, config.prefix.default)
  const digits = Math.min(Math.max(Number.parseInt(String(setting(settings, config.digits.key, config.digits.default)), 10) || config.digits.default, 1), 12)
  const { path, code } = await createNumbered(files, config.invoices, {
    prefix, digits, mime: config.mime,
    build: code => ({
      ...stamp('invoice', config.schema, now),
      code, issueDate: input.issueDate ?? '', dueDate: input.dueDate ?? '', currency: input.currency ?? '',
      reference: input.reference || input.source?.code || '', customerRef: input.customerRef || '',
      customer: input.customer, lines: input.lines.map(line => ({ taxRate: '', ...line })),
      notes: input.notes ?? '', status: 'draft',
      source: { app, path: sourcePath, ...(input.source?.code ? { code: input.source.code } : {}) },
    }),
  })
  return { path, code, created: true }
}

export default serve({ 'create-draft-invoice': createDraftInvoice })
