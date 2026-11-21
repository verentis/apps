# Time Off

Leave types and leave requests stored as JSON files in your workspace. Opening a Time Off record renders
its Canvas form. Time Off folders open in the file browser, where **New** offers the records that belong
there (for example **Leave request** inside `/leave-requests`). Requests move through a status; submitting,
approving and refusing are scripted actions that enforce the transitions. Time Off does not use the
platform business store or business commands.

## Workspace layout

Time Off names records by a generated code, without a file extension:

```text
/leave-types                              application/vnd.verentis.time-off.types (seeded)
  LT-0001 …                               application/vnd.verentis.time-off.type+json (starter leave types, seeded)
/leave-requests                           application/vnd.verentis.time-off.requests (seeded)
  TO-0001                                 application/vnd.verentis.time-off.request+json (sample request, seeded)
/settings/time-off.json                   application/vnd.verentis.time-off.settings+json (seeded)
/applications/time-off/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) — together with starter leave types and a
sample draft request — and uninstall keeps them. No Canvas document is bound to the container types, so
they open in the file browser. Inside a plain folder named like a container (for example `leave` or
`time-off`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `type` | `type-code-prefix` (`LT-`) | Name, `daysPerYear` (a decimal string) and `requiresApproval` |
| `request` | `request-code-prefix` (`TO-`) | Employee name (and an optional Employees reference), leave type, date range, `days`, reason, `status` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived). Days are
exact decimal strings, never floats.

## Request lifecycle

Statuses: `draft | submitted | approved | refused`. The form edits drafts freely; the schema requires the
submission, approval and refusal trails (`submittedAt`, `approver`/`approvedAt`, `refusalReason`/
`refusedAt`), so the later statuses are reached only through the action script:

- **Submit** (`draft` → `submitted`): checks the employee name, leave type and date range, recomputes
  `days` as the weekday (Monday–Friday) count of the inclusive range, and stamps `submittedAt`. When the
  leave type has `requiresApproval: false`, the request is approved in the same step.
- **Approve** (`submitted` → `approved`): records the approver (a form field) and `approvedAt`.
- **Refuse** (`submitted` → `refused`): records the refusal reason (a form field) and `refusedAt`.

Each action is idempotent — re-running a finished one returns a friendly message instead of failing — and
updates the request conditionally (`If-Match`), so a concurrent edit conflicts instead of being
overwritten. Invalid transitions (approving a draft, refusing an approved request, submitting a decided
one) fail with a clear error. Submitted, approved and refused requests lock their form.

## Creation

The create script names the new record (next code) and defaults a request's leave type from the Time Off
settings (`defaultType`). When a request already has both dates, its `days` is filled with the weekday
count; otherwise it stays empty and submitting computes it. Records are written create-only
(`If-None-Match: *`); a taken name moves on to the next code.

## Employees (optional)

Time Off depends on `verentis/employees` optionally. When Employees is installed, the request form offers
its `/employees` records in an **Employee record** select and **Copy name** fills the employee name from
the chosen record. Without Employees the select is simply empty — only the file contracts are shared.

## Pages

- **Time Off** (home): draft/awaiting/approved counts, approved day totals and file browsers over the containers.
- **Requests**: every request with its leave type name, grouped by status.
- **Allocations**: per employee and leave type, the approved days taken against the type's yearly
  allocation and what remains.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/create/main.mjs` and `scripts/post/main.mjs` are hand-written. `vitest run`
validates the contracts, pages and scripts.
