# Helpdesk

Support teams and tickets stored as JSON files in your workspace. Opening a Helpdesk record renders its
Canvas form. Helpdesk folders open in the file browser, where **New** offers the records that belong
there (for example **Ticket** inside `/tickets`). Tickets move through a stage pipeline; resolving and
closing are scripted actions that enforce the transitions. Helpdesk does not use the platform business
store or business commands.

## Workspace layout

Helpdesk names records by a generated code, without a file extension:

```text
/helpdesk-teams                           application/vnd.verentis.helpdesk.teams (seeded)
  TEAM-0001                               application/vnd.verentis.helpdesk.team+json (starter team, seeded)
/tickets                                  application/vnd.verentis.helpdesk.tickets (seeded)
  TKT-0001 …                              application/vnd.verentis.helpdesk.ticket+json (sample tickets, seeded)
/settings/helpdesk.json                   application/vnd.verentis.helpdesk.settings+json (seeded)
/applications/helpdesk/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) — together with a starter team and sample
tickets — and uninstall keeps them. No Canvas document is bound to the container types, so they open in the
file browser. Inside a plain folder named like a container (for example `tickets` or `helpdesk`), New still
offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `team` | `team-code-prefix` (`TEAM-`) | Name, members, `slaHours` — new tickets get a deadline this many hours after creation |
| `ticket` | `ticket-code-prefix` (`TKT-`) | Team reference, subject, optional CRM customer, priority, stage, computed `slaDeadline`, assignee, description, resolution |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Ticket lifecycle

Stages: `new → in-progress → waiting → solved → closed`. The form edits the open stages freely; the
schema requires `resolution` and `resolvedAt` once solved and `closedAt` once closed, so the last two
stages are reached only through the action script:

- **Resolve** (`in-progress`/`waiting` → `solved`): requires the resolution text and stamps `resolvedAt`.
- **Close** (`solved` → `closed`): stamps `closedAt`; the form locks a closed ticket.

Both actions are idempotent — re-running them returns a friendly message instead of failing — and update
the ticket conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Invalid transitions (resolving a new or closed ticket, closing an unsolved one) fail with a clear error.

## SLA deadlines

The create script names the new record (next code), defaults a ticket's team from the Helpdesk settings
(`defaultTeam`), and computes `slaDeadline` as `createdAt` plus the team's `slaHours`. A missing or
unreadable team leaves the deadline empty; the ticket is still created. Records are written create-only
(`If-None-Match: *`); a taken name moves on to the next code.

## Pages

- **Helpdesk** (home): open/overdue/new/solved counts and file browsers over the containers.
- **Tickets**: every active ticket, grouped by stage.
- **SLA report**: open tickets by deadline, flagged `Overdue`, `Due soon` or `On track`.
- **Workload**: open, overdue and solved tickets per team, and open tickets per assignee.

## CRM (optional)

With `verentis/crm` installed, the ticket form offers CRM customers from `/customers` as the
`customerRef` and can copy the customer's name. Without CRM the source simply stays empty; `customerName`
is always a free-text snapshot on the ticket.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/create/main.mjs` and `scripts/post/main.mjs` are hand-written. `vitest run`
validates the contracts, pages and scripts.
