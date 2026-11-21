# Fleet

Vehicles, fleet contracts and service logs, stored as JSON files in your workspace. Opening a Fleet
record renders its Canvas form. Fleet folders open in the file browser, where **New** offers the records
that belong there (for example **Service log** inside `/service-logs`). Logging a service validates the
vehicle and moves its odometer forward; retiring a vehicle enforces the active → retired transition and
locks its form.

## Workspace layout

Records are named by a generated code, without a file extension, directly in their container:

```text
/vehicles                                 application/vnd.verentis.fleet.vehicles (seeded)
  VEH-0001                                …fleet.vehicle+json
/fleet-contracts                          application/vnd.verentis.fleet.contracts (seeded)
  FCON-0001                               …fleet.contract+json
/service-logs                             application/vnd.verentis.fleet.services (seeded)
  FSRV-0001                               …fleet.service+json
/settings/fleet.json                      …fleet.settings+json (seeded)
/applications/fleet/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) together with two sample vehicles
(`VEH-0001` Toyota Corolla, `VEH-0002` Ford Transit), a lease contract and two service logs (one done,
one draft); uninstall keeps them. No Canvas document is bound to the container types, so they open in the
file browser. Inside a plain folder named like a container (for example `fleet` or `services`), New still
offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `vehicle` | `vehicle-code-prefix` (`VEH-`) | Make, model, four-digit year, license plate, VIN, driver name, current odometer in km (decimal string); `status: active \| in-maintenance \| retired` with `retiredAt` once retired |
| `contract` | `contract-code-prefix` (`FCON-`) | Vehicle reference, `type: lease \| insurance \| service`, vendor, start/end dates, monthly cost (string money); `status: active \| expired \| cancelled` |
| `service` | `service-code-prefix` (`FSRV-`) | Vehicle reference, date, odometer reading, `type: maintenance \| repair \| inspection \| other`, description, cost (string money); `status: draft \| done` with `doneAt` once done |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when archived).
Odometer readings and costs are exact decimal strings (`"45200.5"`, `"650.00"`), never JSON numbers.
Records refer to each other by absolute workspace path (a contract's or service log's `vehicle`). Unknown
fields are rejected. `src/contracts.mjs` defines the schemas; `schemas/*.schema.json` are the generated
JSON Schema 2020-12 documents each form validates against.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. Inside the
Fleet containers the script creates the record itself, create-only, and returns its `{ path }`; a taken
code moves on to the next one. Elsewhere it returns a `{ name, content }` proposal the workspace writes
with your own token. New contracts start today and new service logs are dated today.

## Logging and retiring: the post script

`scripts/post` (Node.js, server) is run by the record forms:

- **`log-service`** validates a draft service log — the vehicle exists, is active and not retired, the
  odometer reading is a non-negative decimal at least the vehicle's current odometer, the date is set,
  the cost (when given) parses — then updates the vehicle's odometer to the reading and marks the log
  `done` with `doneAt`. Logging an already-done entry returns a friendly message instead of failing.
- **`retire`** enforces the only transition into `retired`: an `active` vehicle becomes `retired` with
  `retiredAt` and its form locks. A vehicle `in-maintenance` must be set back to active first; an
  already-retired vehicle returns a friendly message.

Integrity: records are saved with `If-Match`, so a concurrent edit conflicts instead of being
overwritten. The two writes of `log-service` are not one transaction: a run interrupted after the vehicle
update passes the odometer check on retry (the reading now equals the vehicle's odometer), skips the
redundant vehicle write and completes the log — re-runs are idempotent and never apply a reading twice.
Kilometres and money are handled as BigInt ten-thousandths — never floats.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Fleet overview with vehicle, contract and service-log browsers |
| `contracts.page.yaml` | entry point | All contracts plus the expiring-soon report (active contracts ending within the configured window, overdue included) |
| `costs.page.yaml` | entry point | Cost summary per vehicle: active contracts' monthly cost plus done service costs |
| `vehicle.form.yaml` | edit | Bound form with a **Retire** action running `retire` and a Service history tab; locked once retired |
| `contract.form.yaml` | edit | Vehicle, type, vendor, term, monthly cost and status |
| `service.form.yaml` | edit | Bound form with a **Log service** action running `log-service`; locked once done |
| `settings.form.yaml` | edit | Edits `/settings/fleet.json` (the expiring-soon window, default 60 days) |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. Report arithmetic runs in the Canvas expression language, which has only floating point, so
amounts are summed as integer ten-thousandths and only divided for display. The build writes each bound
document's registration fields following the Canvas designer projection; the `canvas-origin` packaging
variable is substituted at pack time.

## Build and test

```bash
npm --workspace @verentis/app-fleet run build      # node src/build.mjs
npm --workspace @verentis/app-fleet run check      # fails when generated outputs are stale
npm --workspace @verentis/app-fleet run test:run
```

`src/build.mjs` generates `fleet.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written; `scripts/create/*` and
`scripts/post/ledger.mjs` are copies of the shared `tools/file-apps` sources.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and post scripts.

## Known gaps

- Moving or renaming a record breaks path references (a contract's or service log's `vehicle`).
- Canvas folder sources do not list recursively, so reports only see records directly in the containers.
- Contract statuses (`expired`, `cancelled`) are set on the form; nothing expires a contract automatically.
- The cost summary mixes a rate (monthly contract cost) with totals (done service spend); the columns are
  reported separately, not added together.
