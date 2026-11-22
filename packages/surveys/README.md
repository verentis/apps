# Surveys

Surveys and responses stored as JSON files in your workspace. Opening a Surveys record renders its Canvas
form. Surveys folders open in the file browser, where **New** offers the records that belong there (for
example **Response** inside `/survey-responses`). Surveys move through an open/closed lifecycle and
responses are submitted once; the transitions beyond draft are scripted actions. Surveys does not use the
platform business store or business commands.

## Workspace layout

Surveys names records by a generated code, without a file extension:

```text
/surveys                                  application/vnd.verentis.surveys.surveys (seeded)
  SUR-0001 …                              application/vnd.verentis.surveys.survey+json
/survey-responses                         application/vnd.verentis.surveys.responses (seeded)
  SRS-0001 …                              application/vnd.verentis.surveys.response+json
/settings/surveys.json                    application/vnd.verentis.surveys.settings+json (seeded)
/applications/surveys/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No Canvas
document is bound to the container types, so they open in the file browser. Inside a plain folder named
like a container (for example `surveys` or `responses`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `survey` | `survey-code-prefix` (`SUR-`) | Title, description, status, `questions[]` |
| `response` | `response-code-prefix` (`SRS-`) | Survey reference, optional respondent name and email, status, `answers[]`, `submittedAt` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

A question is `{ sequence, text, kind, choices, required }` — `sequence` is a unique whole number that
answers reference, `kind` is `text`, `single-choice`, `multi-choice` or `rating` (1–5), and `choices`
lists the allowed answers for the choice kinds. An answer is `{ sequence, value }` (or `values` for
multi-choice).

## Survey lifecycle

Statuses: `draft → open → closed`. The form edits drafts freely; the schema requires `openedAt` once open
and `closedAt` once closed, so those statuses are reached only through the action script:

- **Open** (`draft` → `open`): validates the questionnaire — at least one question, unique sequences,
  question text, and at least 2 distinct choices per choice-kind question — then stamps `openedAt`.
- **Close** (`open` → `closed`): stamps `closedAt`; the form locks a closed survey.

## Response lifecycle and answer validation

Statuses: `draft → submitted`. The schema requires `submittedAt` once submitted, so the status is reached
only through the action script:

- **Submit** (`draft` → `submitted`): validates that the referenced survey is open, that every answer
  references an existing question sequence exactly once, that single-choice values and multi-choice
  `values` are among the question's choices, that ratings are whole numbers from 1 to 5, and that every
  required question has a non-empty answer; then stamps `submittedAt` and locks the response.

All actions are idempotent — re-running them returns a friendly message instead of failing — and update
the record conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Invalid transitions fail with a clear error.

## Creating records: the create script

The create script names the new record (next code after the highest existing sibling with the same
prefix) and defaults a response's survey from the Surveys settings (`defaultSurvey`). Records are written
create-only (`If-None-Match: *`); a taken name moves on to the next code.

## Pages

- **Surveys** (home): open/draft/closed survey counts, submitted responses and file browsers over the
  containers.
- **All surveys**: every active survey, grouped by status, with question and response counts.
- **Results**: per-question results computed from the submitted responses — a tally per choice, the
  average rating (one decimal) per rating question and the answered count per text question.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
