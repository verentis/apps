import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { run, materialsTotal } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-10T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

const task = (values = {}) => ({
  ...templates.task, id: uuid(), createdAt: now, updatedAt: now, code: 'FST-0001',
  customerName: 'Globex', address: '1 Main Rd', scheduledDate: '2026-03-10', windowStart: '08:00', windowEnd: '10:00',
  technician: 'Sipho', stage: 'on-site', hours: '2.5',
  materials: [{ description: 'Filter', quantity: '2', unitPrice: '10.50' }, { description: 'Pipe', quantity: '1.5', unitPrice: '8.01' }],
  ...values,
})
const call = (files, operation, extra = {}) => run({ operation, path: '/field-tasks/FST-0001', ...extra }, files, { now, uuid })

describe('Field Service task actions', () => {
  it('schedules a new task with a date and technician, idempotently', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'new' }) })
    expect(await call(files, 'schedule')).toEqual({ message: 'Scheduled FST-0001 for 2026-03-10', path: '/field-tasks/FST-0001' })
    expect(files.json('/field-tasks/FST-0001')).toMatchObject({ stage: 'scheduled', updatedAt: now })
    expect(await call(files, 'schedule')).toMatchObject({ message: 'FST-0001 is already scheduled' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to schedule without a date or technician', async () => {
    const undated = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'new', scheduledDate: '' }) })
    await expect(call(undated, 'schedule')).rejects.toThrow(/needs a scheduled date/)
    const unassigned = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'new', technician: ' ' }) })
    await expect(call(unassigned, 'schedule')).rejects.toThrow(/needs a technician/)
    expect(undated.writes).toEqual([])
  })

  it('starts a scheduled task and refuses other stages', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'scheduled' }) })
    expect(await call(files, 'start')).toMatchObject({ message: 'Started FST-0001' })
    expect(files.json('/field-tasks/FST-0001').stage).toBe('on-site')
    expect(await call(files, 'start')).toMatchObject({ message: 'FST-0001 is already on site' })
    const fresh = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'new' }) })
    await expect(call(fresh, 'start')).rejects.toThrow(/only scheduled tasks can be started/)
  })

  it.each([['scheduled'], ['done'], ['cancelled']])('refuses to complete a %s task', async stage => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ stage, ...(stage === 'done' ? { completedAt: now } : {}), ...(stage === 'cancelled' ? { cancelledAt: now } : {}) }) })
    if (stage === 'done') expect(await call(files, 'complete')).toMatchObject({ message: 'FST-0001 is already done' })
    else await expect(call(files, 'complete')).rejects.toThrow(/only on-site tasks can be completed/)
  })

  it('completes an on-site task with an exact BigInt materials total and locks it', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task() })
    const result = await call(files, 'complete')
    const record = files.json('/field-tasks/FST-0001')
    // 2 × 10.50 + 1.5 × 8.01 = 21.00 + 12.015 → 33.02 (half-up), never floats.
    expect(record).toMatchObject({ stage: 'done', materialsTotal: '33.02', completedAt: now, invoice: '' })
    expect(result.message).toContain('materials 33.02')
  })

  it('requires positive decimal-string hours to complete', async () => {
    const zero = memoryFiles({ '/field-tasks/FST-0001': task({ hours: '0.0' }) })
    await expect(call(zero, 'complete')).rejects.toThrow(/zero hours/)
    const missing = memoryFiles({ '/field-tasks/FST-0001': task({ hours: '' }) })
    await expect(call(missing, 'complete')).rejects.toThrow(/needs hours as a positive decimal/)
    const numeric = memoryFiles({ '/field-tasks/FST-0001': task({ hours: 2.5 }) })
    await expect(call(numeric, 'complete')).rejects.toThrow(/needs hours as a positive decimal/)
  })

  it('rejects malformed material quantities and prices', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ materials: [{ description: 'X', quantity: 'two', unitPrice: '1.00' }] }) })
    await expect(call(files, 'complete')).rejects.toThrow(/material 1 needs a decimal quantity/)
    expect(() => materialsTotal([{ description: 'X', quantity: '1', unitPrice: '1.2.3' }], { code: 'FST-0001' })).toThrow(/decimal unit price/)
    expect(materialsTotal([], { code: 'FST-0001' })).toBe('0.00')
    expect(materialsTotal([{ description: '', quantity: '', unitPrice: '' }], { code: 'FST-0001' })).toBe('0.00')
  })

  it('returns what Invoicing needs to draft the invoice, and never writes Invoicing\'s files', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ customerRef: '/customers/ACME' }), '/invoices': '' })
    const result = await call(files, 'complete')
    expect(result.message).toBe(`Completed FST-0001 (materials ${files.json('/field-tasks/FST-0001').materialsTotal})`)
    expect(files.writes.some(path => path.startsWith('/invoices/'))).toBe(false)
    const contract = parse(readFileSync(new URL('../../invoicing/api.yaml', import.meta.url), 'utf8'))
    const validRequest = new Ajv2020({ strict: false }).compile(contract.spec.operations[0]['input-schema'])
    expect(validRequest(result.invoiceRequest), JSON.stringify(validRequest.errors)).toBe(true)
    expect(result.invoiceRequest).toMatchObject({ source: { path: '/field-tasks/FST-0001', code: 'FST-0001' }, customerRef: '/customers/ACME', customer: { name: 'Globex' } })
    expect(result.invoiceRequest.lines[0]).toMatchObject({ quantity: '2.5' })
    expect(result.invoiceRequest.lines).toHaveLength(3)
  })

  it('records the invoice Invoicing drafted, and asks again for a done task without one', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task() })
    await call(files, 'complete')
    expect((await call(files, 'complete')).invoiceRequest.source.code).toBe('FST-0001')
    await call(files, 'record-invoice', { invoice: '/invoices/INV-0002' })
    expect(files.json('/field-tasks/FST-0001')).toMatchObject({ stage: 'done', invoice: '/invoices/INV-0002' })
    expect((await call(files, 'complete')).invoiceRequest).toBeUndefined()
  })

  it('cancels open tasks and refuses done ones, idempotently', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'scheduled' }) })
    expect(await call(files, 'cancel')).toMatchObject({ message: 'Cancelled FST-0001' })
    expect(files.json('/field-tasks/FST-0001')).toMatchObject({ stage: 'cancelled', cancelledAt: now })
    expect(await call(files, 'cancel')).toMatchObject({ message: 'FST-0001 is already cancelled' })
    const done = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'done', completedAt: now }) })
    await expect(call(done, 'cancel')).rejects.toThrow(/only new, scheduled, on-site tasks can be cancelled/)
  })

  it('refuses archived tasks and anything that is not a task in /field-tasks', async () => {
    const files = memoryFiles({
      '/field-tasks/FST-0001': task({ state: 'archived', archivedAt: now }),
      '/field-tasks/odd': { kind: 'ticket' },
    })
    await expect(call(files, 'start')).rejects.toThrow(/is archived/)
    await expect(call(files, 'start', { path: '/field-tasks/odd' })).rejects.toThrow(/is not a field task/)
    await expect(call(files, 'start', { path: '/field-tasks/missing' })).rejects.toThrow(/does not exist/)
    await expect(call(files, 'start', { path: '/invoices/INV-0001' })).rejects.toThrow(/directly in \/field-tasks/)
    await expect(call(files, 'escalate')).rejects.toThrow(/Unsupported operation/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = memoryFiles({ '/field-tasks/FST-0001': task({ stage: 'new' }) })
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'schedule')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/field-tasks/FST-0001').stage).toBe('new')
  })
})
