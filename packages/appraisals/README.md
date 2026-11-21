# Appraisals

Employee appraisals stored as JSON files in your workspace. Opening an appraisal renders its Canvas form.
The `/appraisals` folder opens in the file browser, where **New** offers the Appraisal record. Appraisals
move through `draft → scheduled → done` (or `cancelled`); scheduling and completing are scripted actions
that enforce the transitions and compute the overall score. Appraisals does not use the platform business
store or business commands.

## Workspace layout

Appraisals names records by a generated code, without a file extension:

```text
/appraisals                               application/vnd.verentis.appraisals.appraisals (seeded)
  APR-0001 …                              application/vnd.verentis.appraisals.appraisal+json
/settings/appraisals.json                 application/vnd.verentis.appraisals.settings+json (seeded)
/applications/appraisals/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The container is a
content-less typed node. Install seeds it once (`mode: seed`) and uninstall keeps it. No Canvas document is
bound to the container type, so it opens in the file browser. Inside a plain folder named like the
container, New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `appraisal` | `appraisal-code-prefix` (`APR-`) | Employee name and optional employee reference, period, manager, status `draft / scheduled / done / cancelled`, scheduled date, ratings (criteria + score `1`–`5`), overall score (exact decimal string), summary |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Appraisal lifecycle

Statuses: `draft → scheduled → done`, or `cancelled`. The form edits drafts and scheduled appraisals; the
schema requires `completedAt` once done and `cancelledAt` once cancelled, so `done` is reached only through
the action script:

- **Schedule** (`draft` → `scheduled`): uses the appraisal's scheduled date, defaulting to today when
  empty.
- **Complete** (`scheduled` → `done`): requires at least one rating, computes the overall score as the
  exact two-decimal average of the rating scores (half-up, in integer hundredths), stamps `completedAt`;
  the form locks a done appraisal.

Both actions are idempotent — re-running a finished one returns a friendly message instead of failing — and
update the appraisal conditionally (`If-Match`), so a concurrent edit conflicts instead of being
overwritten. Invalid transitions (scheduling a done or cancelled appraisal, completing a draft) fail with a
clear error.

## Employees (optional)

Appraisals declares an optional dependency on `verentis/employees` and integrates through file contracts
only: the appraisal form offers employee records from `/employees`
(`application/vnd.verentis.employees.employee+json`) for the employee reference and can copy the referenced
employee's name. Without Employees, the folder is simply empty and the fields stay free-form.

## Creating records

The create script names the new record (next code) and defaults the manager from the Appraisals settings
(`defaultManager`). Records are written create-only (`If-None-Match: *`); a taken name moves on to the next
code. Overall scores are exact decimal strings (`"4.33"`), never JSON numbers.

## Pages

- **Appraisals** (home): draft/scheduled/done counts, the average score and a file browser over
  `/appraisals`.
- **Appraisals by status**: every active appraisal, grouped by status.
- **Scores**: completed appraisals by overall score and the average per manager.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
