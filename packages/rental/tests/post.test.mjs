import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'
import { schemas as invoicingSchemas } from '../../invoicing/src/contracts.mjs'
import { lateDays, rentalDays, run } from '../scripts/post/main.mjs'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validInvoice = ajv.compile(invoicingSchemas.invoice)

const record = (kind, values) => ({
  $schema: `https://schemas.verentis.io/rental/v1/${kind}.schema.json`, schemaVersion: 1, kind,
  id: `00000000-0000-4000-8000-00000000000${values.code?.at(-1) ?? '0'}`, state: 'active',
  createdAt: '2026-03-01T08:00:00Z', updatedAt: '2026-03-01T08:00:00Z', ...values,
})

const product = (code, values = {}) => record('product', {
  code, name: `Product ${code}`, dailyRate: '100.00', deposit: '50.00', quantityOwned: 3, description: '', status: 'available', ...values,
})

const booking = (code, values = {}) => record('booking', {
  code, customerRef: '', customerName: 'Thandi Nkosi', product: '/rental-products/RPRD-0001', quantity: 2,
  startDate: '2026-03-10', endDate: '2026-03-12', dailyRate: '', deposit: '', notes: '', status: 'draft', ...values,
})

const settings = (values = {}) => ({
  $schema: 'https://schemas.verentis.io/rental/v1/settings.schema.json', schemaVersion: 1, kind: 'settings',
  currency: 'ZAR', dailyLateRate: '10.00', notes: '', ...values,
})

function workspace(extra = {}) {
  return memoryFiles({
    '/settings/rental.json': settings(),
    '/rental-products/RPRD-0001': product('RPRD-0001'),
    '/rental-bookings/RENT-0001': booking('RENT-0001'),
    ...extra,
  })
}

const options = { now: '2026-03-10T08:00:00Z', uuid: () => '11111111-1111-4111-8111-111111111111' }
const call = (files, operation, path = '/rental-bookings/RENT-0001', parameters = {}) =>
  run({ operation, path, ...parameters }, files, options)

describe('date arithmetic', () => {
  it('counts rental days inclusively and late days past the end date', () => {
    expect(rentalDays('2026-03-10', '2026-03-10')).toBe(1)
    expect(rentalDays('2026-03-10', '2026-03-12')).toBe(3)
    expect(rentalDays('2026-02-27', '2026-03-02')).toBe(4) // leap year
    expect(lateDays('2026-03-12', '2026-03-12')).toBe(0)
    expect(lateDays('2026-03-12', '2026-03-10')).toBe(0)
    expect(lateDays('2026-03-12', '2026-03-15')).toBe(3)
  })
})

describe('confirm-booking', () => {
  it('snapshots the product rate and deposit and computes days × rate × quantity exactly', async () => {
    const files = workspace()
    const result = await call(files, 'confirm-booking')
    expect(result.message).toContain('3 days × 100.00 × 2 = 600.00')
    const saved = await files.readJson('/rental-bookings/RENT-0001')
    expect(saved).toMatchObject({
      status: 'confirmed', confirmedAt: options.now, dailyRate: '100.00', deposit: '50.00',
      total: '600.00', updatedAt: options.now,
    })
  })

  it('prefers a rate and deposit entered on the booking and avoids float drift', async () => {
    const files = workspace({
      '/rental-bookings/RENT-0001': booking('RENT-0001', { dailyRate: '0.10', deposit: '0.30', quantity: 3 }),
    })
    await call(files, 'confirm-booking')
    const saved = await files.readJson('/rental-bookings/RENT-0001')
    expect(saved.total).toBe('0.90') // 3 days × 0.10 × 3; 0.1 + 0.2 ≠ 0.3 in floats
    expect(saved.deposit).toBe('0.30')
  })

  it('is idempotent once confirmed', async () => {
    const files = workspace()
    await call(files, 'confirm-booking')
    const before = await files.readJson('/rental-bookings/RENT-0001')
    const again = await call(files, 'confirm-booking')
    expect(again.message).toContain('already confirmed')
    expect(await files.readJson('/rental-bookings/RENT-0001')).toEqual(before)
  })

  it('rejects an end date before the start date', async () => {
    const files = workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { startDate: '2026-03-12', endDate: '2026-03-10' }) })
    await expect(call(files, 'confirm-booking')).rejects.toThrow(/end date .* before the start date/)
  })

  it('rejects the booking when overlapping bookings exhaust the owned units', async () => {
    const files = workspace({
      '/rental-bookings/RENT-0002': booking('RENT-0002', {
        status: 'confirmed', confirmedAt: '2026-03-01T08:00:00Z', dailyRate: '100.00', total: '200.00',
        startDate: '2026-03-12', endDate: '2026-03-14', quantity: 2,
      }),
    })
    await expect(call(files, 'confirm-booking')).rejects.toThrow(/Only 1 of RPRD-0001 is available .*3 owned, 2 reserved/)
    expect((await files.readJson('/rental-bookings/RENT-0001')).status).toBe('draft')
  })

  it('ignores cancelled, returned and non-overlapping bookings when checking availability', async () => {
    const files = workspace({
      '/rental-bookings/RENT-0002': booking('RENT-0002', { status: 'cancelled', cancelledAt: '2026-03-01T08:00:00Z', quantity: 3 }),
      '/rental-bookings/RENT-0003': booking('RENT-0003', {
        status: 'returned', confirmedAt: '2026-03-01T08:00:00Z', pickedUpAt: '2026-03-01T09:00:00Z',
        returnedAt: '2026-03-02T09:00:00Z', dailyRate: '100.00', total: '300.00', lateFee: '0.00', quantity: 3,
      }),
      '/rental-bookings/RENT-0004': booking('RENT-0004', {
        status: 'confirmed', confirmedAt: '2026-03-01T08:00:00Z', dailyRate: '100.00', total: '100.00',
        startDate: '2026-03-13', endDate: '2026-03-14', quantity: 3,
      }),
    })
    await expect(call(files, 'confirm-booking')).resolves.toMatchObject({ message: expect.stringContaining('Confirmed RENT-0001') })
  })

  it('refuses unavailable products, foreign paths and zero rates', async () => {
    await expect(call(workspace({ '/rental-products/RPRD-0001': product('RPRD-0001', { status: 'unavailable' }) }), 'confirm-booking'))
      .rejects.toThrow(/unavailable for rent/)
    await expect(call(workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { product: '/customers/ACME' }) }), 'confirm-booking'))
      .rejects.toThrow(/Choose a rental product/)
    await expect(call(workspace({ '/rental-products/RPRD-0001': product('RPRD-0001', { dailyRate: '0.00' }) }), 'confirm-booking'))
      .rejects.toThrow(/daily rate is zero/)
    await expect(call(workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { customerName: ' ' }) }), 'confirm-booking'))
      .rejects.toThrow(/customer's name/)
    await expect(call(workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { quantity: 0 }) }), 'confirm-booking'))
      .rejects.toThrow(/whole number of units/)
  })

  it('refuses a cancelled booking until it is reopened', async () => {
    const files = workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { status: 'cancelled', cancelledAt: options.now }) })
    await expect(call(files, 'confirm-booking')).rejects.toThrow(/cancelled. Reopen it first/)
  })

  it('fails instead of overwriting a booking that changed while being posted', async () => {
    const files = workspace()
    const stat = files.stat.bind(files)
    files.stat = async path => {
      const metadata = await stat(path)
      if (path === '/rental-bookings/RENT-0001') await files.touch(path)
      return metadata
    }
    await expect(call(files, 'confirm-booking')).rejects.toThrow(/changed while it was being posted/)
  })
})

describe('the full lifecycle', () => {
  it('moves a booking through confirm → pickup → return and charges no fee for an on-time return', async () => {
    const files = workspace()
    await call(files, 'confirm-booking')
    await expect(call(files, 'pickup-booking')).resolves.toMatchObject({ message: 'RENT-0001 picked up' })
    const result = await call(files, 'return-booking', undefined, { date: '2026-03-12' })
    expect(result.message).toBe('RENT-0001 returned')
    expect(await files.readJson('/rental-bookings/RENT-0001')).toMatchObject({
      status: 'returned', pickedUpAt: options.now, returnedAt: options.now, lateFee: '0.00', total: '600.00',
    })
  })

  it('charges late days × settings rate × quantity when returned past the end date', async () => {
    const files = workspace()
    await call(files, 'confirm-booking')
    await call(files, 'pickup-booking')
    const result = await call(files, 'return-booking', undefined, { date: '2026-03-15' })
    expect(result.message).toContain('60.00 late fee (3 days late)')
    expect((await files.readJson('/rental-bookings/RENT-0001')).lateFee).toBe('60.00')
  })

  it('defaults the return date to today when the form leaves it empty', async () => {
    const files = workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { startDate: '2026-03-01', endDate: '2026-03-08' }) })
    await call(files, 'confirm-booking')
    await call(files, 'pickup-booking')
    await call(files, 'return-booking', undefined, { date: '' }) // options.now is 2026-03-10, two days late
    expect((await files.readJson('/rental-bookings/RENT-0001')).lateFee).toBe('40.00')
  })

  it('is idempotent at every stage and rejects invalid transitions', async () => {
    const files = workspace()
    await expect(call(files, 'pickup-booking')).rejects.toThrow(/is draft. Only confirmed bookings/)
    await expect(call(files, 'return-booking')).rejects.toThrow(/is draft. Only picked-up bookings/)
    await call(files, 'confirm-booking')
    await expect(call(files, 'return-booking')).rejects.toThrow(/is confirmed. Only picked-up bookings/)
    await call(files, 'pickup-booking')
    await expect(call(files, 'pickup-booking')).resolves.toMatchObject({ message: expect.stringContaining('already picked up') })
    await expect(call(files, 'cancel-booking')).rejects.toThrow(/is picked up. Only draft and confirmed/)
    await call(files, 'return-booking', undefined, { date: '2026-03-12' })
    await expect(call(files, 'return-booking')).resolves.toMatchObject({ message: expect.stringContaining('already returned') })
    await expect(call(files, 'confirm-booking')).resolves.toMatchObject({ message: expect.stringContaining('already returned') })
    await expect(call(files, 'cancel-booking')).rejects.toThrow(/Only draft and confirmed/)
  })

  it('cancels draft and confirmed bookings idempotently', async () => {
    const files = workspace()
    await call(files, 'confirm-booking')
    await expect(call(files, 'cancel-booking')).resolves.toMatchObject({ message: 'RENT-0001 cancelled' })
    expect(await files.readJson('/rental-bookings/RENT-0001')).toMatchObject({ status: 'cancelled', cancelledAt: options.now })
    await expect(call(files, 'cancel-booking')).resolves.toMatchObject({ message: expect.stringContaining('already cancelled') })
  })
})

describe('the drafted invoice', () => {
  const withInvoicing = () => workspace({ '/invoices': '' })

  async function returned(files, date = '2026-03-15') {
    await call(files, 'confirm-booking')
    await call(files, 'pickup-booking')
    return call(files, 'return-booking', undefined, { date })
  }

  it('is skipped entirely when Invoicing is not installed', async () => {
    const files = workspace()
    await returned(files)
    expect((await files.readJson('/rental-bookings/RENT-0001')).invoice).toBeUndefined()
    expect(await files.stat('/invoices/RENT-0001')).toBeNull()
  })

  it('satisfies Invoicing\'s published invoice contract, including the late-fee line', async () => {
    const files = withInvoicing()
    const result = await returned(files)
    expect(result.message).toContain('drafted invoice RENT-0001')
    expect((await files.readJson('/rental-bookings/RENT-0001')).invoice).toEqual({ path: '/invoices/RENT-0001' })
    expect((await files.stat('/invoices/RENT-0001')).contentType).toBe('application/vnd.verentis.invoicing.invoice+json')
    const invoice = await files.readJson('/invoices/RENT-0001')
    expect(validInvoice(invoice), JSON.stringify(validInvoice.errors)).toBe(true)
    expect(invoice).toMatchObject({
      status: 'draft', currency: 'ZAR', reference: 'RENT-0001', customer: { name: 'Thandi Nkosi' },
      notes: 'Drafted from rental booking RENT-0001.',
    })
    expect(invoice.lines).toEqual([
      { description: 'Rental RENT-0001: 2 × RPRD-0001, 3 days at 100.00/day', quantity: '1', unitPrice: '600.00', taxRate: '' },
      { description: 'Late return: 3 days past 2026-03-12', quantity: '1', unitPrice: '60.00', taxRate: '' },
    ])
  })

  it('omits the late-fee line for an on-time return', async () => {
    const files = withInvoicing()
    await returned(files, '2026-03-12')
    expect((await files.readJson('/invoices/RENT-0001')).lines).toHaveLength(1)
  })

  it('is written once even when an interrupted return is retried', async () => {
    const files = withInvoicing()
    await call(files, 'confirm-booking')
    await call(files, 'pickup-booking')
    const write = files.write.bind(files)
    let interrupted = false
    files.write = async (path, body, options_) => {
      const result = await write(path, body, options_)
      if (path.startsWith('/invoices/') && !interrupted) {
        interrupted = true
        throw Object.assign(new Error('boom'), { status: 500 })
      }
      return result
    }
    await expect(call(files, 'return-booking', undefined, { date: '2026-03-12' })).rejects.toThrow('boom')
    await expect(call(files, 'return-booking', undefined, { date: '2026-03-12' })).resolves.toMatchObject({
      message: expect.stringContaining('drafted invoice'),
    })
    expect(files.writes.filter(path => path === '/invoices/RENT-0001')).toHaveLength(1) // the retry hit If-None-Match and adopted the draft
    expect((await files.readJson('/invoices/RENT-0001')).kind).toBe('invoice')
    expect((await files.readJson('/rental-bookings/RENT-0001')).status).toBe('returned')
  })

  it('refuses to adopt a foreign file squatting on the invoice name', async () => {
    const files = withInvoicing()
    await files.write('/invoices/RENT-0001', JSON.stringify({ kind: 'note' }), { contentType: 'application/json' })
    await expect(returned(files)).rejects.toThrow(/belongs to something else/)
  })
})

describe('guard rails', () => {
  it('rejects unknown operations and records outside the bookings container', async () => {
    const files = workspace()
    await expect(run({ operation: 'approve' }, files, options)).rejects.toThrow(/Unsupported operation "approve"/)
    await expect(call(files, 'confirm-booking', '/rental-products/RPRD-0001')).rejects.toThrow(/directly in \/rental-bookings/)
    await expect(call(files, 'confirm-booking', '/rental-bookings/missing')).rejects.toThrow(/does not exist/)
  })

  it('refuses archived bookings', async () => {
    const files = workspace({ '/rental-bookings/RENT-0001': booking('RENT-0001', { state: 'archived' }) })
    await expect(call(files, 'confirm-booking')).rejects.toThrow(/archived/)
  })
})
