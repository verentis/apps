import { describe, expect, it } from 'vitest'
import { templates } from '../src/contracts.mjs'
import { applyDefaults, nextCode, propose } from '../scripts/create/propose.mjs'
import { createRecord } from '../scripts/create/main.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-03-04T09:30:05.000Z'
const uuid = () => 'abcd1234-0000-4000-8000-000000000000'
const settings = (values = {}) => ({ get: key => values[key] })
const input = (creatable, values = {}) => ({
  operation: 'create', creatable, parentPath: '/journals', template: JSON.stringify(templates[creatable], null, 2), now, siblings: [], ...values,
})

describe('Accounting create script', () => {
  it('continues from the highest matching code', () => {
    expect(nextCode('ACC-', 4, ['ACC-0006', 'ACC-x', 'JRN-0099'])).toBe('ACC-0007')
  })

  it('dates new journals today and takes the currency from the Accounting settings', () => {
    const documents = { '/settings/accounting.json': { baseCurrency: 'ZAR' } }
    const result = propose(input('journal', { siblings: ['JRN-0002'], name: 'Opening balances' }), settings(), uuid, documents)
    expect(result.name).toBe('JRN-0003')
    expect(result.content).toMatchObject({ code: 'JRN-0003', description: 'Opening balances', date: '2026-03-04', currency: 'ZAR', status: 'draft' })
    expect(propose(input('expense'), settings({ 'expense-code-prefix': 'E', 'code-digits': 2 }), uuid).content).toMatchObject({ code: 'E01', currency: '' })
  })

  it('keeps values the template already has and adds days to dates', () => {
    const record = applyDefaults({ issueDate: '2026-01-30', dueDate: '', currency: 'USD' },
      { dueDate: { file: '/s', pointer: 'days', addDaysTo: 'issueDate' }, currency: { file: '/s', pointer: 'currency' } }, now, { '/s': { days: 30, currency: 'ZAR' } })
    expect(record).toEqual({ issueDate: '2026-01-30', dueDate: '2026-03-01', currency: 'USD' })
  })

  it('writes inside its containers create-only and moves past taken names', async () => {
    const files = memoryFiles({ '/settings/accounting.json': { baseCurrency: 'ZAR' }, '/journals/JRN-0001': '{}' })
    const result = await createRecord({ ...input('journal'), mime: 'application/vnd.verentis.accounting.journal+json' }, settings(), files, { uuid })
    expect(result).toEqual({ path: '/journals/JRN-0002' })
    expect(files.json('/journals/JRN-0002')).toMatchObject({ code: 'JRN-0002', currency: 'ZAR' })
  })

  it('proposes instead of writing outside its containers', async () => {
    const files = memoryFiles()
    const result = await createRecord(input('journal', { parentPath: '/elsewhere' }), settings(), files, { uuid })
    expect(result.name).toBe('JRN-0001')
    expect(files.writes).toEqual([])
  })
})
