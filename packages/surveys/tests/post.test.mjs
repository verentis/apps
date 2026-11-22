import { describe, expect, it } from 'vitest'
import { run } from '../scripts/post/main.mjs'
import { templates } from '../src/contracts.mjs'
import { memoryFiles } from '../../../tools/file-apps/memory-files.mjs'

const now = '2026-06-01T08:00:00Z'
let ids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
const question = (values = {}) => ({ sequence: 1, text: 'How was it?', kind: 'text', choices: [], required: false, ...values })
const questionnaire = [
  question({ sequence: 1, text: 'Overall?', kind: 'rating', required: true }),
  question({ sequence: 2, text: 'Channel?', kind: 'single-choice', choices: ['Web', 'Email'], required: true }),
  question({ sequence: 3, text: 'Topics?', kind: 'multi-choice', choices: ['Docs', 'API', 'UI'] }),
  question({ sequence: 4, text: 'Anything else?', kind: 'text' }),
]
const survey = (values = {}) => ({
  ...templates.survey, id: uuid(), createdAt: now, updatedAt: now, code: 'SUR-0001',
  title: 'Launch feedback', status: 'open', openedAt: now, questions: questionnaire, ...values,
})
const response = (values = {}) => ({
  ...templates.response, id: uuid(), createdAt: now, updatedAt: now, code: 'SRS-0001',
  survey: '/surveys/SUR-0001', respondentName: 'Avery Adams', status: 'draft',
  answers: [
    { sequence: 1, value: '4' },
    { sequence: 2, value: 'Web' },
    { sequence: 3, values: ['Docs', 'API'] },
  ], ...values,
})
const call = (files, operation, path) => run({ operation, path }, files, { now })

describe('Surveys survey actions', () => {
  it('opens a draft survey with a valid questionnaire, idempotently', async () => {
    const files = memoryFiles({ '/surveys/SUR-0001': survey({ status: 'draft', openedAt: undefined }) })
    expect(await call(files, 'open', '/surveys/SUR-0001')).toEqual({ message: 'Opened SUR-0001', path: '/surveys/SUR-0001' })
    expect(files.json('/surveys/SUR-0001')).toMatchObject({ status: 'open', openedAt: now, updatedAt: now })
    expect(await call(files, 'open', '/surveys/SUR-0001')).toMatchObject({ message: 'SUR-0001 is already open' })
    expect(files.writes).toHaveLength(1)
  })

  it('refuses to open an invalid questionnaire', async () => {
    const files = memoryFiles({
      '/surveys/SUR-0001': survey({ status: 'draft', openedAt: undefined, questions: [] }),
      '/surveys/SUR-0002': survey({ code: 'SUR-0002', status: 'draft', openedAt: undefined, questions: [question(), question({ text: 'Again?' })] }),
      '/surveys/SUR-0003': survey({ code: 'SUR-0003', status: 'draft', openedAt: undefined, questions: [question({ kind: 'single-choice', choices: ['Only', ' '] })] }),
      '/surveys/SUR-0004': survey({ code: 'SUR-0004', status: 'draft', openedAt: undefined, questions: [question({ text: '  ' })] }),
      '/surveys/SUR-0005': survey({ code: 'SUR-0005', status: 'draft', openedAt: undefined, questions: [question({ kind: 'multi-choice', choices: ['Same', 'Same'] })] }),
    })
    await expect(call(files, 'open', '/surveys/SUR-0001')).rejects.toThrow(/has no questions/)
    await expect(call(files, 'open', '/surveys/SUR-0002')).rejects.toThrow(/sequence 1 is used more than once/)
    await expect(call(files, 'open', '/surveys/SUR-0003')).rejects.toThrow(/needs at least 2 choices/)
    await expect(call(files, 'open', '/surveys/SUR-0004')).rejects.toThrow(/has no text/)
    await expect(call(files, 'open', '/surveys/SUR-0005')).rejects.toThrow(/duplicate choices/)
    expect(files.writes).toEqual([])
  })

  it('refuses to open a closed survey', async () => {
    const files = memoryFiles({ '/surveys/SUR-0001': survey({ status: 'closed', closedAt: now }) })
    await expect(call(files, 'open', '/surveys/SUR-0001')).rejects.toThrow(/only draft surveys can be opened/)
  })

  it('closes an open survey, idempotently, and never a draft one', async () => {
    const files = memoryFiles({ '/surveys/SUR-0001': survey(), '/surveys/SUR-0002': survey({ code: 'SUR-0002', status: 'draft', openedAt: undefined }) })
    expect(await call(files, 'close', '/surveys/SUR-0001')).toEqual({ message: 'Closed SUR-0001', path: '/surveys/SUR-0001' })
    expect(files.json('/surveys/SUR-0001')).toMatchObject({ status: 'closed', closedAt: now })
    expect(await call(files, 'close', '/surveys/SUR-0001')).toMatchObject({ message: 'SUR-0001 is already closed' })
    await expect(call(files, 'close', '/surveys/SUR-0002')).rejects.toThrow(/only open surveys can be closed/)
    expect(files.writes).toHaveLength(1)
  })

  it('refuses archived surveys and anything that is not a survey in /surveys', async () => {
    const files = memoryFiles({
      '/surveys/SUR-0001': survey({ status: 'draft', openedAt: undefined, state: 'archived', archivedAt: now }),
      '/surveys/odd': { kind: 'response' },
    })
    await expect(call(files, 'open', '/surveys/SUR-0001')).rejects.toThrow(/is archived/)
    await expect(call(files, 'open', '/surveys/odd')).rejects.toThrow(/is not a survey/)
    await expect(call(files, 'open', '/surveys/missing')).rejects.toThrow(/does not exist/)
    await expect(call(files, 'open', '/survey-responses/SRS-0001')).rejects.toThrow(/directly in \/surveys/)
    await expect(call(files, 'launch', '/surveys/SUR-0001')).rejects.toThrow(/Unsupported operation/)
  })
})

describe('Surveys response actions', () => {
  const workspace = (extra = {}) => memoryFiles({
    '/surveys/SUR-0001': survey(),
    '/survey-responses/SRS-0001': response(),
    ...extra,
  })

  it('submits a valid draft response, idempotently, stamping and locking it', async () => {
    const files = workspace()
    expect(await call(files, 'submit', '/survey-responses/SRS-0001')).toEqual({ message: 'Submitted SRS-0001', path: '/survey-responses/SRS-0001' })
    expect(files.json('/survey-responses/SRS-0001')).toMatchObject({ status: 'submitted', submittedAt: now, updatedAt: now })
    expect(await call(files, 'submit', '/survey-responses/SRS-0001')).toMatchObject({ message: 'SRS-0001 is already submitted' })
    expect(files.writes).toHaveLength(1)
  })

  it.each([['draft', {}], ['closed', { closedAt: now }]])('refuses to submit to a %s survey', async (status, extra) => {
    const files = workspace({ '/surveys/SUR-0001': survey({ status, openedAt: status === 'draft' ? undefined : now, ...extra }) })
    await expect(call(files, 'submit', '/survey-responses/SRS-0001')).rejects.toThrow(/only be submitted to open surveys/)
    expect(files.json('/survey-responses/SRS-0001').status).toBe('draft')
  })

  it('refuses a missing survey reference', async () => {
    const files = workspace({
      '/survey-responses/SRS-0002': response({ code: 'SRS-0002', survey: '' }),
      '/survey-responses/SRS-0003': response({ code: 'SRS-0003', survey: '/surveys/SUR-9999' }),
    })
    await expect(call(files, 'submit', '/survey-responses/SRS-0002')).rejects.toThrow(/Choose the survey/)
    await expect(call(files, 'submit', '/survey-responses/SRS-0003')).rejects.toThrow(/does not exist/)
  })

  it('requires every required question to be answered', async () => {
    const files = workspace({
      '/survey-responses/SRS-0002': response({ code: 'SRS-0002', answers: [{ sequence: 1, value: '4' }] }),
      '/survey-responses/SRS-0003': response({ code: 'SRS-0003', answers: [{ sequence: 1, value: '4' }, { sequence: 2, value: '  ' }] }),
    })
    await expect(call(files, 'submit', '/survey-responses/SRS-0002')).rejects.toThrow(/Question 2 \(Channel\?\) is required/)
    await expect(call(files, 'submit', '/survey-responses/SRS-0003')).rejects.toThrow(/Question 2 \(Channel\?\) is required/)
    expect(files.writes).toEqual([])
  })

  it('accepts an empty answer to an optional question', async () => {
    const files = workspace({ '/survey-responses/SRS-0001': response({ answers: [
      { sequence: 1, value: '5' }, { sequence: 2, value: 'Email' }, { sequence: 3, values: [] }, { sequence: 4, value: '' },
    ] }) })
    expect(await call(files, 'submit', '/survey-responses/SRS-0001')).toMatchObject({ message: 'Submitted SRS-0001' })
  })

  it('refuses answers to unknown or duplicate question sequences', async () => {
    const files = workspace({
      '/survey-responses/SRS-0002': response({ code: 'SRS-0002', answers: [...response().answers, { sequence: 9, value: 'x' }] }),
      '/survey-responses/SRS-0003': response({ code: 'SRS-0003', answers: [...response().answers, { sequence: 2, value: 'Email' }] }),
    })
    await expect(call(files, 'submit', '/survey-responses/SRS-0002')).rejects.toThrow(/has no question with sequence 9/)
    await expect(call(files, 'submit', '/survey-responses/SRS-0003')).rejects.toThrow(/Question 2 is answered more than once/)
  })

  it('validates single-choice, multi-choice and rating answers', async () => {
    const bad = answers => workspace({ '/survey-responses/SRS-0001': response({ answers }) })
    await expect(call(bad([{ sequence: 1, value: '4' }, { sequence: 2, value: 'Fax' }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 2 has no choice "Fax"/)
    await expect(call(bad([{ sequence: 1, value: '4' }, { sequence: 2, value: 'Web' }, { sequence: 3, values: ['Docs', 'CLI'] }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 3 has no choice "CLI"/)
    await expect(call(bad([{ sequence: 1, value: '4' }, { sequence: 2, value: 'Web' }, { sequence: 3, values: ['Docs', 'Docs'] }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 3 repeats a choice/)
    await expect(call(bad([{ sequence: 1, value: '6' }, { sequence: 2, value: 'Web' }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 1 takes a rating from 1 to 5/)
    await expect(call(bad([{ sequence: 1, value: '3.5' }, { sequence: 2, value: 'Web' }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 1 takes a rating from 1 to 5/)
    await expect(call(bad([{ sequence: 1, value: '4' }, { sequence: 2, value: 'Web' }, { sequence: 3, value: 'Docs' }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 3 is multi-choice; use values/)
    await expect(call(bad([{ sequence: 1, value: '4' }, { sequence: 2, value: 'Web', values: ['Web'] }]), 'submit', '/survey-responses/SRS-0001'))
      .rejects.toThrow(/Question 2 is single-choice; use value/)
  })

  it('fails instead of overwriting a concurrent edit', async () => {
    const files = workspace()
    const write = files.write
    files.write = async (path, content, options) => { files.touch(path); files.write = write; return write(path, content, options) }
    await expect(call(files, 'submit', '/survey-responses/SRS-0001')).rejects.toThrow(/changed while it was being updated/)
    expect(files.json('/survey-responses/SRS-0001').status).toBe('draft')
  })
})
