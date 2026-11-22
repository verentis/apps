# Quality

Quality control points, checks and alerts stored as JSON files in your workspace. Opening a Quality record
renders its Canvas form. Quality folders open in the file browser, where **New** offers the records that
belong there (for example **Quality check** inside `/quality-checks`). Recording a check and resolving an
alert are scripted actions that enforce the result and stage transitions. Quality does not use the platform
business store or business commands.

## Workspace layout

Quality names records by a generated code, without a file extension:

```text
/quality-control-points                   application/vnd.verentis.quality.points (seeded)
  QCP-0001 …                              application/vnd.verentis.quality.point+json
/quality-checks                           application/vnd.verentis.quality.checks (seeded)
  QCK-0001 …                              application/vnd.verentis.quality.check+json
/quality-alerts                           application/vnd.verentis.quality.alerts (seeded)
  QAL-0001 …                              application/vnd.verentis.quality.alert+json
/applications/quality/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No Canvas
document is bound to the container types, so they open in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `point` | `point-code-prefix` (`QCP-`) | Control point: title, product/operation reference, check type `pass-fail` or `measure`, measure target and tolerance min/max (exact decimal strings), frequency note, `active` switch |
| `check` | `check-code-prefix` (`QCK-`) | Control point reference, date (defaults to today), source reference (MO/PO code), result `pending → pass`/`fail`, measured value (decimal string), notes |
| `alert` | `alert-code-prefix` (`QAL-`) | Title, optional source check reference, severity `low`/`medium`/`high`, stage `new → investigation → action → resolved`, root cause, corrective action |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived). Measures
and tolerances are exact decimal strings (`"12.5"`), never JSON numbers.

## Check lifecycle

A check is recorded once: `pending → pass | fail`. The schema requires `checkedAt` once recorded, so the
final results are reached only through the action script:

- **Record pass / Record fail** (`record-check`): validates against the check's control point (it must
  exist and be active). For `measure` points the measured value is compared against the tolerance
  (inclusive bounds, at least one of min/max required); a verdict that contradicts the tolerance is
  refused with the correct one. On **fail**, a high-severity quality alert is raised create-only at
  `/quality-alerts/<check code>-AL` and linked from the check — retries never raise a second alert, and a
  foreign file at that name fails the run.
- **Resolve** (`resolve-alert`, `investigation`/`action` → `resolved`): requires the root cause and the
  corrective action, stamps `resolvedAt`; the form locks a resolved alert.

Both actions are idempotent — re-running them returns a friendly message instead of failing — and update
the records conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Invalid transitions (recording a recorded check, resolving a new alert) fail with a clear error.

## Pages

- **Quality** (home): pending/failed check and open alert counts and file browsers over the containers.
- **Quality checks**: every active check, grouped by result.
- **Quality alerts**: every active alert, boarded by stage.
- **Control points**: every active control point with its check counts.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/create/main.mjs` and `scripts/post/main.mjs` are hand-written. `vitest run`
validates the contracts, pages and scripts.
