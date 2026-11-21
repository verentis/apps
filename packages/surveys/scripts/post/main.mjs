// Opens and closes Surveys surveys and submits responses. Canvas forms run this script (run-script) against a
// saved record; it enforces the status transitions (draft → open → closed, draft → submitted), validates the
// questionnaire before opening and every answer before submitting, and updates records conditionally (If-Match),
// so a concurrent edit fails instead of being overwritten. Re-running a finished operation returns a friendly
// message instead of failing, so retries are safe.
export const operations = ['open', 'close', 'submit']
export const surveys = {
  surveys: '/surveys',
  responses: '/survey-responses',
  surveyMime: 'application/vnd.verentis.surveys.survey+json',
  responseMime: 'application/vnd.verentis.surveys.response+json',
}
/** The question kinds whose `choices` list the allowed answers. */
export const choiceKinds = ['single-choice', 'multi-choice']
export const ratingMax = 5

class SurveysError extends Error {}
export const fail = message => { throw new SurveysError(message) }
const statusOf = error => error?.statusCode ?? error?.status
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = (record, fallback) => record.code || fallback

function checkPath(path, root, noun) {
  if (typeof path !== 'string' || !path.startsWith(`${root}/`) || path.slice(root.length + 1).includes('/')) {
    fail(`Expected ${noun} directly in ${root} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** A record with the ETag it was read at, so the update can be conditional. */
async function readRecord(files, path, kind) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== kind) fail(`${path} is not a ${kind}.`)
  if (record.state === 'archived') fail(`${label(record, path)} is archived. Restore it first.`)
  return { path, record, etag: metadata.etag }
}

const readSurvey = (files, path) => readRecord(files, checkPath(path, surveys.surveys, 'a survey'), 'survey')
const readResponse = (files, path) => readRecord(files, checkPath(path, surveys.responses, 'a response'), 'response')

/**
 * Writes the changed record back only if nobody changed it since it was read: a concurrent edit fails with a
 * conflict instead of being overwritten.
 */
async function saveRecord(files, { path, record, etag }, mime) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: mime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being updated. Reload it and try again.`)
    throw error
  }
}

/** The questionnaire a survey can be opened with: non-empty, unique sequences, enough choices per choice kind. */
export function checkQuestions(questions, surveyLabel) {
  if (!Array.isArray(questions) || questions.length === 0) fail(`${surveyLabel} has no questions. Add at least one before opening.`)
  const seen = new Set()
  for (const question of questions) {
    const sequence = question?.sequence
    if (!Number.isInteger(sequence) || sequence < 1) fail(`Every question needs a whole sequence of at least 1 (got ${JSON.stringify(sequence ?? '')}).`)
    if (seen.has(sequence)) fail(`Question sequence ${sequence} is used more than once. Sequences must be unique.`)
    seen.add(sequence)
    if (!String(question.text || '').trim()) fail(`Question ${sequence} has no text.`)
    if (choiceKinds.includes(question.kind)) {
      const choices = (question.choices || []).filter(choice => String(choice || '').trim())
      if (choices.length < 2) fail(`Question ${sequence} is ${question.kind} and needs at least 2 choices.`)
      if (new Set(choices).size !== choices.length) fail(`Question ${sequence} has duplicate choices.`)
    }
  }
}

/** draft → open, stamping `openedAt`, after validating the questionnaire. */
export async function openSurvey(files, path, { now }) {
  const survey = await readSurvey(files, path)
  const { record } = survey
  if (record.status === 'open') return { message: `${label(record, path)} is already open`, path }
  if (record.status !== 'draft') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only draft surveys can be opened.`)
  checkQuestions(record.questions, label(record, path))
  Object.assign(record, { status: 'open', openedAt: now, updatedAt: now })
  await saveRecord(files, survey, surveys.surveyMime)
  return { message: `Opened ${label(record, path)}`, path }
}

/** open → closed, stamping `closedAt`. The form locks a closed survey. */
export async function closeSurvey(files, path, { now }) {
  const survey = await readSurvey(files, path)
  const { record } = survey
  if (record.status === 'closed') return { message: `${label(record, path)} is already closed`, path }
  if (record.status !== 'open') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only open surveys can be closed.`)
  Object.assign(record, { status: 'closed', closedAt: now, updatedAt: now })
  await saveRecord(files, survey, surveys.surveyMime)
  return { message: `Closed ${label(record, path)}`, path }
}

const answered = (question, answer) => {
  if (question.kind === 'multi-choice') return (answer?.values || []).length > 0
  return String(answer?.value || '').trim() !== ''
}

/** One answer against its question: valid choices, a rating in range, values only on multi-choice. */
function checkAnswer(question, answer) {
  const sequence = question.sequence
  if (question.kind === 'multi-choice') {
    if (String(answer.value || '').trim()) fail(`Question ${sequence} is multi-choice; use values, not value.`)
    for (const value of answer.values || []) {
      if (!(question.choices || []).includes(value)) fail(`Question ${sequence} has no choice ${JSON.stringify(value)}.`)
    }
    if (new Set(answer.values || []).size !== (answer.values || []).length) fail(`Question ${sequence} repeats a choice.`)
    return
  }
  if ((answer.values || []).length) fail(`Question ${sequence} is ${question.kind}; use value, not values.`)
  const value = String(answer.value || '').trim()
  if (!value) return
  if (question.kind === 'single-choice' && !(question.choices || []).includes(answer.value)) {
    fail(`Question ${sequence} has no choice ${JSON.stringify(answer.value)}.`)
  }
  if (question.kind === 'rating') {
    const rating = Number(value)
    if (!Number.isInteger(rating) || rating < 1 || rating > ratingMax) {
      fail(`Question ${sequence} takes a rating from 1 to ${ratingMax} (got ${JSON.stringify(answer.value)}).`)
    }
  }
}

/**
 * draft → submitted, stamping `submittedAt` and locking the response. The survey must be open, every answer must
 * reference an existing question sequence with valid choices or rating, and every required question must be answered.
 */
export async function submitResponse(files, path, { now }) {
  const response = await readResponse(files, path)
  const { record } = response
  if (record.status === 'submitted') return { message: `${label(record, path)} is already submitted`, path }
  if (record.status !== 'draft') fail(`${label(record, path)} is ${record.status ?? 'in no status'}; only draft responses can be submitted.`)
  if (!record.survey) fail('Choose the survey before submitting.')
  const { record: survey } = await readSurvey(files, record.survey)
  if (survey.status !== 'open') {
    fail(`${label(survey, record.survey)} is ${survey.status ?? 'in no status'}; responses can only be submitted to open surveys.`)
  }
  const questions = new Map((survey.questions || []).map(question => [question.sequence, question]))
  const seen = new Set()
  for (const answer of record.answers || []) {
    const question = questions.get(answer?.sequence)
    if (!question) fail(`${label(survey, record.survey)} has no question with sequence ${JSON.stringify(answer?.sequence ?? '')}.`)
    if (seen.has(answer.sequence)) fail(`Question ${answer.sequence} is answered more than once.`)
    seen.add(answer.sequence)
    checkAnswer(question, answer)
  }
  for (const question of questions.values()) {
    if (!question.required) continue
    const answer = (record.answers || []).find(candidate => candidate.sequence === question.sequence)
    if (!answer || !answered(question, answer)) fail(`Question ${question.sequence} (${question.text}) is required.`)
  }
  Object.assign(record, { status: 'submitted', submittedAt: now, updatedAt: now })
  await saveRecord(files, response, surveys.responseMime)
  return { message: `Submitted ${label(record, path)}`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  const options = { now }
  if (operation === 'open') return openSurvey(files, path, options)
  if (operation === 'close') return closeSurvey(files, path, options)
  if (operation === 'submit') return submitResponse(files, path, options)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
