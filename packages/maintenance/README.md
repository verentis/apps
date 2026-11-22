# Maintenance

Equipment and maintenance requests stored as JSON files in your workspace. Opening a Maintenance record
renders its Canvas form. Maintenance folders open in the file browser, where **New** offers the records
that belong there (for example **Maintenance request** inside `/maintenance-requests`). Starting,
completing and scrapping a request are scripted actions that enforce the stage transitions and keep the
equipment status in sync. Maintenance does not use the platform business store or business commands.

## Workspace layout

Maintenance names records by a generated code, without a file extension:

```text
/equipment                                application/vnd.verentis.maintenance.equipments (seeded)
  EQP-0001 …                              application/vnd.verentis.maintenance.equipment+json
/maintenance-requests                     application/vnd.verentis.maintenance.requests (seeded)
  MREQ-0001 …                             application/vnd.verentis.maintenance.request+json
/applications/maintenance/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No Canvas
document is bound to the container types, so they open in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `equipment` | `equipment-code-prefix` (`EQP-`) | Name, category, serial, location, assigned to, status `operational`/`under-maintenance`/`scrapped`, purchase date, warranty end |
| `request` | `request-code-prefix` (`MREQ-`) | Equipment reference, type `corrective`/`preventive`, priority, description, stage, scheduled date (defaults to today), duration hours (exact decimal string) |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Request lifecycle

Stages: `new → in-progress → repaired`, with `scrap` reachable from `new` or `in-progress`. The schema
requires `startedAt`, `completedAt` and `scrappedAt` along the way, so the later stages are reached only
through the action script, which also keeps the equipment status in sync:

- **Start** (`start-request`, `new` → `in-progress`): puts the equipment `under-maintenance`; scrapped
  equipment refuses.
- **Complete** (`complete-request`, `in-progress` → `repaired`): returns the equipment to `operational`,
  stamps `completedAt`; the form locks a repaired request.
- **Scrap** (`scrap`, `new`/`in-progress` → `scrap`): scraps the request and its equipment; both lock.

All actions are idempotent — re-running them returns a friendly message instead of failing — and update
both records conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten. The
equipment is flipped before the request is saved and an already-flipped status is skipped, so a run
interrupted between the two writes completes safely on retry. Invalid transitions (completing a new
request, starting a repaired one) fail with a clear error.

## Pages

- **Maintenance** (home): open/in-progress request and equipment status counts and file browsers over the
  containers.
- **Maintenance requests**: every active request, boarded by stage.
- **Equipment**: every active piece of equipment with its status and open request count.
- **Preventive plan**: open preventive requests by scheduled date, flagged `Overdue`, `Upcoming` (within
  30 days) or `Planned`.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/create/main.mjs` and `scripts/post/main.mjs` are hand-written. `vitest run`
validates the contracts, pages and scripts.
