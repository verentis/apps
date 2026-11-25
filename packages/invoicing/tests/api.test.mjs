import { describe, expect, it } from 'vitest'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { createDraftInvoice } from '../scripts/api/main.mjs'

const settings = { get: () => undefined }
const input = {
  source: { path: '/quotations/QUO-0003.json', code: 'QUO-0003' }, currency: 'ZAR', reference: 'Kitchen refit',
  customer: { name: 'Cedar Studio' }, lines: [{ description: '2 × Workshop', quantity: '1', unitPrice: '810.00' }],
}

describe('Invoicing API', () => {
  it('drafts a numbered invoice for the calling app and returns the same draft when asked again', async () => {
    const files = memoryFiles({ '/invoices/INV-0004': { kind: 'invoice', code: 'INV-0004' } })
    const context = { files, settings, caller: { app: 'sales' }, now: '2026-11-25T10:00:00Z' }

    const first = await createDraftInvoice(input, context)
    expect(first).toEqual({ path: '/invoices/INV-0005', code: 'INV-0005', created: true })
    const invoice = files.json('/invoices/INV-0005')
    expect(invoice).toMatchObject({ kind: 'invoice', status: 'draft', currency: 'ZAR', reference: 'Kitchen refit',
      source: { app: 'sales', path: '/quotations/QUO-0003.json', code: 'QUO-0003' } })
    expect(invoice.lines[0]).toEqual({ taxRate: '', description: '2 × Workshop', quantity: '1', unitPrice: '810.00' })

    const again = await createDraftInvoice(input, context)
    expect(again).toEqual({ path: '/invoices/INV-0005', code: 'INV-0005', created: false })
    // Another app asking for a record of the same path gets its own draft.
    expect((await createDraftInvoice(input, { ...context, caller: { app: 'rental' } })).code).toBe('INV-0006')
  })
})
