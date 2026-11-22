# Recruitment

Job positions and candidates stored as JSON files in your workspace. Opening a Recruitment record renders
its Canvas form. Recruitment folders open in the file browser, where **New** offers the records that belong
there (for example **Candidate** inside `/candidates`). Candidates move through a hiring pipeline; advancing,
refusing and hiring are scripted actions that enforce the transitions. Recruitment does not use the platform
business store or business commands.

## Workspace layout

Recruitment names records by a generated code, without a file extension:

```text
/job-positions                            application/vnd.verentis.recruitment.jobs (seeded)
  JOB-0001 …                              application/vnd.verentis.recruitment.job+json
/candidates                               application/vnd.verentis.recruitment.candidates (seeded)
  APP-0001 …                              application/vnd.verentis.recruitment.candidate+json
/settings/recruitment.json                application/vnd.verentis.recruitment.settings+json (seeded)
/applications/recruitment/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No Canvas
document is bound to the container types, so they open in the file browser. Inside a plain folder named
like a container (for example `candidates` or `recruitment`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `job` | `job-code-prefix` (`JOB-`) | Title, department, status `open / on-hold / closed`, openings count |
| `candidate` | `candidate-code-prefix` (`APP-`) | Name, job position reference, email, phone, source, stage, expected salary (exact decimal string), notes, refusal reason |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Candidate lifecycle

Stages: `new → screening → interview → offer`, then `hired` or `refused`. The form edits the open stages
freely; the schema requires `hiredAt` once hired and `refusalReason` once refused, so the terminal stages
are reached only through the action script:

- **Advance** (`new`/`screening`/`interview` → the next stage): one step at a time; a candidate already at
  `offer` gets a friendly message instead.
- **Hire** (`offer` → `hired`): stamps `hiredAt`; the form locks a hired candidate.
- **Refuse** (any open stage → `refused`): requires the refusal reason; the form locks a refused candidate.

All actions are idempotent — re-running a finished one returns a friendly message instead of failing — and
update the candidate conditionally (`If-Match`), so a concurrent edit conflicts instead of being
overwritten. Invalid transitions (advancing or refusing a hired candidate, hiring before the offer stage)
fail with a clear error.

## Creating records

The create script names the new record (next code) and defaults a candidate's job position from the
Recruitment settings (`defaultJob`). Records are written create-only (`If-None-Match: *`); a taken name
moves on to the next code. Expected salaries are exact decimal strings (`"45000.00"`), never JSON numbers.

## Pages

- **Recruitment** (home): pipeline/interview/hired/refused counts and file browsers over the containers.
- **Pipeline**: every active candidate, grouped by stage.
- **Positions**: every active job position with its openings, pipeline and hire counts.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
