// Purchase's API script (see api.yaml): the operations other apps call through the platform. It runs with Purchase's
// own file access; callers never write /purchase-orders themselves.
import { createNumbered, fail, listRecords, serve, setting, stamp } from './runtime.mjs'
import config from './config.mjs'

/**
 * Drafts a purchase order with the asked-for lines, numbered like any new order. A draft already made for the same
 * calling app and source is returned instead of a second one, so a retried call never orders twice.
 */
export async function createDraftOrder(input, { files, settings, caller, now }) {
  const app = String(caller?.app ?? '')
  if (!app) fail('The calling app is unknown.')
  const sourcePath = String(input.source?.path ?? '')
  const existing = (await listRecords(files, config.orders))
    .find(({ record }) => record?.kind === 'order' && record.source?.app === app && record.source?.path === sourcePath)
  if (existing) return { path: existing.path, code: existing.record.code, created: false }
  const prefix = setting(settings, config.prefix.key, config.prefix.default)
  const digits = Math.min(Math.max(Number.parseInt(String(setting(settings, config.digits.key, config.digits.default)), 10) || config.digits.default, 1), 12)
  const { path, code } = await createNumbered(files, config.orders, {
    prefix, digits, mime: config.mime,
    build: code => ({
      ...stamp('order', config.schema, now),
      code, vendor: '', vendorName: input.vendorName ?? '', reference: input.source?.code ?? '',
      orderDate: now.slice(0, 10), expectedDate: '', currency: input.currency ?? '',
      lines: input.lines.map(line => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice ?? '' })),
      notes: input.notes ?? '', status: 'draft',
      source: { app, path: sourcePath, ...(input.source?.code ? { code: input.source.code } : {}) },
    }),
  })
  return { path, code, created: true }
}

export default serve({ 'create-draft-order': createDraftOrder })
