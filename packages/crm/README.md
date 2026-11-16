# CRM

Customers (companies), contacts, deals, cases, communications (email, call, meeting, task) and notes,
stored as JSON files in your workspace. Opening a CRM record renders its Canvas form. CRM folders open
in the file browser, where **New** offers the records that belong there (for example **Customer**
inside `/customers`). CRM does not use the platform business store or business commands.

## Workspace layout

Any node can have content and children. CRM names records by a generated code, without a file
extension, and hangs everything that belongs to a record beneath it:

```text
/customers                                application/vnd.verentis.crm.customers (seeded)
  CUST-0001                               application/vnd.verentis.crm.company+json
    activities/20260102-093005-email.json …crm.email+json  (also call, meeting, task)
    notes/20260102-101500-note.json       …crm.note+json
    documents/<any file>                  any type (Documents tab)
  CON-0001                                application/vnd.verentis.crm.contact+json
/deals                                    application/vnd.verentis.crm.deals (seeded)
  DEAL-0001                               application/vnd.verentis.crm.deal+json  (same children)
/cases                                    application/vnd.verentis.crm.cases (seeded)
  CASE-0001                               application/vnd.verentis.crm.case+json  (same children)
/settings/crm.json                        application/vnd.verentis.crm.settings+json (seeded)
/applications/crm/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is.
`activities/`, `notes/` and `documents/` are plain folders created on first use.

The containers are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps
them. No Canvas document is bound to the container types, so they open in the file browser. Inside a
plain folder named like a container (for example `clients` or `tickets`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `company` (Customer) | `customer-code-prefix` (`CUST-`) | Relationship type, contact details, address, tags |
| `contact` | `contact-code-prefix` (`CON-`) | Optional `company` reference |
| `deal` | `deal-code-prefix` (`DEAL-`) | Customer, stage, decimal `amount`, currency, `probability`, outcome; `closedAt` and `lostReason` |
| `case` | `case-code-prefix` (`CASE-`) | Support case: status, priority, type, origin; `resolvedAt` is required when resolved or closed |
| `email`, `call`, `meeting`, `task` | – | Communications; `subject`, `regarding`, `owner`; tasks need `completedAt` when completed |
| `note` | – | Free text about the record |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Archiving only sets `state`. Date-time fields that people enter (meeting start, due dates)
are local wall-clock values (`2026-01-02T09:30`); audit instants are UTC. Unknown fields are rejected.

`src/contracts.mjs` defines the schemas. `schemas/*.schema.json` are the generated JSON Schema 2020-12
documents. Each form binds its MIME type with a `json-schema` entry, so uploaded JSON whose `$schema`
matches a CRM schema ID is classified as that type. The schema IDs are identifiers, not hosted endpoints.

### References

A record refers to another by absolute workspace path: `{ "path": "/customers/CUST-0001", "nodeId": "<optional uuid>" }`.
A contact's `company`, a deal's `customer`/`contact`, a case's `customer`/`contact`, and every
communication's or note's `regarding` use this shape. Moving or renaming a record breaks path
references; `nodeId` is reserved for resolving that later.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. When you pick
**New → Customer**, the workspace runs `scripts/create` (Node.js, server) with the template, the parent
path and the parent's child names. Inside `/customers`, `/deals` and `/cases` the script creates the
record itself, create-only, and returns its `{ path }`; the workspace opens it. Its `manifest.yaml` declares
`file-access: write` on those three containers, which `verentis pack` copies into the app manifest, so
installing the CRM asks for that consent. Elsewhere (a parent outside those containers, or a run without
write access) the script returns a `{ name, content }` proposal that the workspace writes create-only with
your own token.

- Records get the next code after the highest existing sibling with the same prefix (`CUST-0042`).
  A code taken in the meantime moves on to the next one (up to five attempts).
  Prefixes and digits come from the CRM settings. If the highest-numbered record is deleted, its code is reused.
- Communications and notes are named by UTC time (`activities/20260102-093005-email.json`) and get a
  `regarding` reference to the record. A clash retries with a random suffix.

`scripts/create/propose.mjs` holds the naming logic and `main.mjs` the create-only write (both unit tested). `scripts/create/config.mjs` is generated
from the contracts. Record forms can also create communications and notes directly (the **New email**
… buttons), using the same naming without a script run.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Customers, contacts, open deals, weighted pipeline and open cases; a browser tab per container |
| `company.form.yaml`, `contact.form.yaml`, `deal.form.yaml`, `case.form.yaml` | edit | Header with status and code; tabs for Overview, Activities, related records, Notes and Documents |
| `email`, `call`, `meeting`, `task`, `note` `.form.yaml` | edit | Child forms with a link back to the record they are about |
| `settings.form.yaml` | none | Edits `/settings/crm.json` and the code settings |
| `follow-ups.widget.page.yaml` | `spec.widgets` | The **Follow-ups** dashboard widget (below) |

- Forms load the file through a `kind: document` source with `consistency: conditional` and save with `save`.
- The Activities, Notes and Documents tabs use the `canvas.files` component on `./activities/`,
  `./notes/` and `./documents/`, filtered by MIME type (All, Emails, Calls, Meetings, Tasks).
- Related records (a customer's contacts, deals and cases) are tables over `folder` sources on the
  containers, filtered by reference.
- Record forms declare `spec.access` read grants for the containers they show (for example `/deals`
  from a customer) and for `/applications/crm/`. Child forms declare none and stay confined to their file.

The build writes each bound document's registration fields (`entry`, `scope`, `mime-types`,
`permissions`, `capabilities`, `file-access`, `sandbox`) following the Canvas designer projection.
The `canvas-origin` packaging variable is substituted at pack time.

## Workspace desktop

CRM contributes a **Follow-ups** widget (`crm.follow-ups`, default 4×5) to workspace dashboards. It is a
Canvas page rendered on the widget surface and lists what needs chasing: open cases (new, open or pending)
by priority, and open deals whose expected close date has passed or falls within the next 14 days, overdue
deals first. Clicking a row opens the record's form. It reads only `/deals` and `/cases`.

Tasks, calls and meetings live under each record's `activities/` folder; Canvas folder sources do not list
recursively, so the widget cannot show activities that are due.

## Build and test

```bash
npm --workspace @verentis/app-crm run build      # node src/build.mjs
npm --workspace @verentis/app-crm run check      # fails when generated outputs are stale
npm --workspace @verentis/app-crm run test:run
```

`src/build.mjs` generates `crm.app.yaml`, `environments/production.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and `scripts/create/config.mjs` from `src/app.mjs`, `src/contracts.mjs` and `src/pages.mjs`.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine (0.2.0) for the create script.

## Known gaps

- `spec.access` is enforced by the Canvas runtime; the platform still issues workspace-wide file tokens to bound forms.
- In-form ids come from `Math.random` shaped as v4 UUIDs. Canvas has no UUID helper.
- Canvas exposes no current-user identity, so `owner` is entered by hand and records carry no `createdBy`.
- Creating a record runs a server script, which can take a few seconds.
- Invoicing still reads CRM customers from the business store.
- The committed `crm.app.yaml` and `canvas/*` are YAML, while `src/build.mjs` still writes JSON, so `check` reports them
  stale; the tests compare the generator's model with the parsed YAML instead.
