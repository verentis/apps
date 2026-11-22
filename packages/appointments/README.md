# Appointments

Appointment scheduling as files in your workspace: appointment types with durations and buffers, and bookings
with conflict-checked confirmation. Bookings live beside your records and sync with your schedule.

## How it works

Every appointment type and appointment is one JSON file in a seeded container, typed by its vendor MIME
(`application/vnd.verentis.appointments.type+json` / `…appointment+json`) and validated against the installed
JSON Schema. Records are created from the platform **New** menu by the create script, which numbers them
(`APT-0001`, `APMT-0001`; prefixes and width are app settings), fills a new appointment's date and default type
from `/settings/appointments.json`, and — when a start time and type are already chosen — computes the end time
from the type's duration and copies the type's host.

### Workspace layout

| Path | Contents |
| --- | --- |
| `/appointment-types` | Appointment type records (duration, buffer, host, location), one JSON file each (seeded container) |
| `/appointments` | Appointment records, one JSON file per booking, named by their code (seeded container) |
| `/settings/appointments.json` | Defaults new appointments start with (seeded) |
| `/applications/appointments` | The installed app: Canvas documents, schemas, templates, scripts (managed) |

Seeds live outside the install root on purpose: uninstalling removes the app but keeps your bookings.

### Appointment flow

An appointment moves `booked → confirmed → done`, or to `cancelled` / `no-show` from either active status. The
status is changed only by the action script the appointment form runs:

- **Confirm** requires a date and start time, completes the schedule from the type (an empty end time becomes
  the start plus the type's duration; an empty host is copied from the type), and rejects the confirmation when
  the host already has an overlapping booked or confirmed appointment on that date — with the type's
  `bufferMinutes` kept free around the booking. Back-to-back appointments without a buffer are fine.
- **Complete** stamps `completedAt` and locks the appointment.
- **Cancel** and **No-show** stamp `cancelledAt` / `noShowAt` and lock the appointment.

All updates are conditional (`If-Match`), so a concurrent edit conflicts instead of being overwritten, and
re-running a finished operation returns a friendly message instead of failing.

### Pages

- **Appointments** — overview with counts and the appointment and type lists.
- **Upcoming** — today's and all upcoming booked and confirmed appointments in schedule order.
- **Types** — every type with its duration, buffer and booking counts.

## Development

```bash
node src/build.mjs            # regenerate manifest, Canvas documents, schemas, templates, seeds and scripts
node src/build.mjs --check    # fail if any generated output is stale
npm run test:run              # vitest: contracts, pages, create and action-script tests
```

Hand-authored sources are `src/contracts.mjs`, `src/app.mjs`, `src/pages.mjs`, `src/build.mjs`,
`scripts/create/main.mjs` and `scripts/post/main.mjs`; everything else under `canvas/`, `schemas/`,
`templates/`, `seed/` and `scripts/` is generated.
