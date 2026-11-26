// File-based Surveys record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  array, code, fillTemplate, object, optional, optionalEmail, pathOrEmpty, schemas as schemaKit, text,
  timestamp, whenStatus,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/surveys'
export const schemaBase = 'https://schemas.verentis.io/surveys/v1'
// Seeds live outside the app record (installRoot): uninstall removes the record but keeps the surveys.
export const settingsPath = '/settings/surveys.json'

const vendor = kind => `application/vnd.verentis.surveys.${kind}+json`

export const mimeTypes = {
  surveys: 'application/vnd.verentis.surveys.surveys',
  responses: 'application/vnd.verentis.surveys.responses',
  survey: vendor('survey'),
  response: vendor('response'),
  settings: vendor('settings'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  surveys: { path: '/surveys', mime: mimeTypes.surveys, holds: ['survey'] },
  responses: { path: '/survey-responses', mime: mimeTypes.responses, holds: ['response'] },
}

/** Records are named by a generated code (`SUR-0001`) and stored without an extension in their container. */
export const recordKinds = ['survey', 'response']
export const containerOf = { survey: 'surveys', response: 'responses' }

export const codeSettings = {
  survey: { key: 'survey-code-prefix', default: 'SUR-', label: 'Survey code prefix' },
  response: { key: 'response-code-prefix', default: 'SRS-', label: 'Response code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** Survey statuses. `open` and `closed` are reached only through the survey action script. */
export const surveyStatuses = ['draft', 'open', 'closed']
/** Response statuses. `submitted` is reached only through the submit action, which locks the response. */
export const responseStatuses = ['draft', 'submitted']
/** Question kinds. Choice kinds need at least two choices; ratings are 1 to `ratingMax`. */
export const questionKinds = ['text', 'single-choice', 'multi-choice', 'rating']
/** The kinds whose `choices` list the allowed answers. */
export const choiceKinds = ['single-choice', 'multi-choice']
export const ratingMax = 5

const { schemaId, recordSchema, settingsSchema, recordTemplate } = schemaKit(schemaBase, 'Surveys')
export { schemaId }

const sequence = { type: 'integer', minimum: 1, maximum: 999 }

/** One question of a survey; `choices` matter only for the choice kinds. */
export const question = object({
  sequence,
  text,
  kind: { enum: questionKinds },
  choices: array({ type: 'string', maxLength: 200 }, 0, 50),
  required: { type: 'boolean' },
})

/** One answer of a response: `value` for text, ratings and single choices; `values` for multiple choices. */
export const answer = object({
  sequence,
  value: optional(1000),
  values: array({ type: 'string', maxLength: 200 }, 0, 50),
}, ['sequence'])

// Title fields may be empty on disk: a generated record opens straight into its form, which requires them.
export const schemas = {
  survey: recordSchema('survey', 'survey', {
    code,
    title: text,
    description: optional(10000),
    status: { enum: surveyStatuses },
    questions: array(question, 0, 100),
    openedAt: timestamp,
    closedAt: timestamp,
  }, ['code', 'title', 'description', 'status', 'questions'], [
    whenStatus(['open', 'closed'], ['openedAt']),
    whenStatus(['closed'], ['closedAt']),
  ]),
  response: recordSchema('response', 'response', {
    code,
    survey: pathOrEmpty,
    respondentName: optional(200),
    respondentEmail: optionalEmail,
    status: { enum: responseStatuses },
    answers: array(answer, 0, 100),
    submittedAt: timestamp,
  }, ['code', 'survey', 'respondentName', 'respondentEmail', 'status', 'answers'], [
    whenStatus(['submitted'], ['submittedAt']),
  ]),
  settings: settingsSchema({
    defaultSurvey: pathOrEmpty,
  }, ['defaultSurvey']),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}`, `{{ name }}` and `{{ user }}` (who is creating) are substituted; the create script then adds
 * the generated `code` and fills a response's survey from the Surveys settings.
 */
export const templates = {
  survey: recordTemplate('survey', {
    title: '{{ name }}', description: '', status: 'draft', questions: [],
  }),
  response: recordTemplate('response', {
    survey: '', respondentName: '{{ name }}', respondentEmail: '', status: 'draft', answers: [],
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {
  survey: {},
  response: { survey: { file: settingsPath, pointer: 'defaultSurvey' } },
}

export const defaultSettings = {
  $schema: schemaId('settings'), schemaVersion: 1, defaultSurvey: '',
}

export { fillTemplate }
