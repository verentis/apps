# Planning

Shift planning as files in your workspace: roles and shifts with a week schedule, overlap-checked publishing
and confirmed, locked shifts. The Verentis Planning equivalent of Odoo Planning.

## How it works

Every shift role and shift is one JSON file in a seeded container, typed by its vendor MIME
(`application/vnd.verentis.planning.role+json` / `…shift+json`) and validated against the installed JSON
Schema. Records are created from the platform **New** menu by the create script, which numbers them
(`PLR-0001`, `SHF-0001`; prefixes and width are app settings) and fills new shifts' date and default role from
`/settings/planning.json`.

### Workspace layout

| Path | Contents |
| --- | --- |
| `/shift-roles` | Shift role records (name, color note), one JSON file per role (seeded container) |
| `/shifts` | Shift records, one JSON file per shift, named by their code (seeded container) |
| `/settings/planning.json` | Defaults new shifts start with (seeded) |
| `/applications/planning` | The installed app: Canvas documents, schemas, templates, scripts (managed) |

Seeds live outside the install root on purpose: uninstalling removes the app but keeps your schedule.

### Shift flow

A shift moves `draft → published → confirmed`. The status is changed only by the action script the shift form
runs:

- **Publish** requires a complete schedule — a date, HH:MM start and end times with the end after the start,
  and an employee — and rejects the publish when the employee already has an overlapping published or
  confirmed shift on that date (back-to-back shifts are fine).
- **Confirm** stamps `confirmedAt` and locks the shift.

All updates are conditional (`If-Match`), so a concurrent edit conflicts instead of being overwritten, and
re-running a finished operation returns a friendly message instead of failing.

### Optional dependency

- **Employees** — the shift form offers employee records from `/employees` and can copy the chosen employee's
  name. The select simply stays empty when Employees is not installed.

### Pages

- **Planning** — overview with counts and the role and shift lists.
- **Week schedule** — the next seven days, grouped by date and by employee, with the full week list.
- **Shifts** — every active shift, grouped by status.

## Development

```bash
node src/build.mjs            # regenerate manifest, Canvas documents, schemas, templates, seeds and scripts
node src/build.mjs --check    # fail if any generated output is stale
npm run test:run              # vitest: contracts, pages, create and action-script tests
```

Hand-authored sources are `src/contracts.mjs`, `src/app.mjs`, `src/pages.mjs`, `src/build.mjs` and
`scripts/post/main.mjs`; everything else under `canvas/`, `schemas/`, `templates/`, `seed/` and `scripts/` is
generated.
