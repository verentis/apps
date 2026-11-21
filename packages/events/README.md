# Events

Events and registrations stored as JSON files in your workspace. Opening an Events record renders its
Canvas form. Events folders open in the file browser, where **New** offers the records that belong there
(for example **Registration** inside `/event-registrations`). Events move through a publishing lifecycle
and registrations through a confirmation pipeline; the transitions beyond draft are scripted actions.
Events does not use the platform business store or business commands.

## Workspace layout

Events names records by a generated code, without a file extension:

```text
/events                                   application/vnd.verentis.events.events (seeded)
  EVT-0001 …                              application/vnd.verentis.events.event+json
/event-registrations                      application/vnd.verentis.events.registrations (seeded)
  EVR-0001 …                              application/vnd.verentis.events.registration+json
/settings/events.json                     application/vnd.verentis.events.settings+json (seeded)
/applications/events/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No Canvas
document is bound to the container types, so they open in the file browser. Inside a plain folder named
like a container (for example `events` or `registrations`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `event` | `event-code-prefix` (`EVT-`) | Name, venue or online link, UTC `startsAt`/`endsAt`, integer `capacity`, string `ticketPrice`, status, description |
| `registration` | `registration-code-prefix` (`EVR-`) | Event reference, attendee name and email, integer `qty` (seats), status, `confirmedAt` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived). Money
(`ticketPrice`) is an exact decimal string, never a JSON number.

## Event lifecycle

Statuses: `draft → published → ongoing → done`, or `cancelled`. The form edits drafts freely and may move
a published event to `ongoing`; the schema requires `publishedAt` once published, `completedAt` once done
and `cancelledAt` once cancelled, so those statuses are reached only through the action script:

- **Publish** (`draft` → `published`): requires a start time and stamps `publishedAt`.
- **Complete** (`published`/`ongoing` → `done`): stamps `completedAt`; the form locks a done event.
- **Cancel** (`draft`/`published`/`ongoing` → `cancelled`): stamps `cancelledAt`; the form locks it.

## Registration lifecycle and capacity

Statuses: `draft → confirmed → attended`, or `cancelled`. The schema requires `confirmedAt` once
confirmed or attended, so those statuses are reached only through the action script:

- **Confirm** (`draft` → `confirmed`): validates that the event is published or ongoing and that its
  remaining capacity — capacity minus the seats other confirmed and attended registrations take — covers
  this registration's `qty`, then stamps `confirmedAt`.
- **Check in** (`confirmed` → `attended`): the form locks an attended registration.
- **Cancel** (`draft`/`confirmed` → `cancelled`): releases the seats; attended registrations cannot be
  cancelled.

All actions are idempotent — re-running them returns a friendly message instead of failing — and update
the record conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Invalid transitions fail with a clear error.

## Creating records: the create script

The create script names the new record (next code after the highest existing sibling with the same
prefix) and defaults an event's venue from the Events settings (`defaultVenue`). Records are written
create-only (`If-None-Match: *`); a taken name moves on to the next code.

## Pages

- **Events** (home): published/ongoing/draft counts, confirmed seats and file browsers over the containers.
- **All events**: every active event, grouped by status, with seats taken against capacity.
- **Registrations**: capacity and attendance per event (confirmed + attended seats vs capacity) and every
  registration.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
