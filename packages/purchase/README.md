# Purchase

Vendors and purchase orders (RFQs), stored as JSON files in your workspace. Opening a Purchase record
renders its Canvas form. Purchase folders open in the file browser, where **New** offers the records
that belong there (for example **Purchase order** inside `/purchase-orders`). Purchase does not use the
platform business store or business commands.

## Workspace layout

Any node can have content and children. Purchase names records by a generated code, without a file
extension, directly in their container:

```text
/vendors                                  application/vnd.verentis.purchase.vendors (seeded)
  VEND-0001                               application/vnd.verentis.purchase.vendor+json
/purchase-orders                          application/vnd.verentis.purchase.orders (seeded)
  PO-0001                                 application/vnd.verentis.purchase.order+json
/settings/purchase.json                   application/vnd.verentis.purchase.settings+json (seeded)
/applications/purchase/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers
are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No
Canvas document is bound to the container types, so they open in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `vendor` | `vendor-code-prefix` (`VEND-`) | Name, contact details, address, payment terms (days), currency |
| `order` (Purchase order) | `order-code-prefix` (`PO-`) | Vendor reference, order and expected dates, lines (description, quantity, unit price), `status: draft → sent → confirmed → received`, or `cancelled` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Quantities, unit prices and the total are exact decimal strings (`"1250.00"`), never JSON
numbers. Unknown fields are rejected.

An order refers to its vendor by absolute workspace path (`"vendor": "/vendors/VEND-0001"`).
Confirming snapshots the vendor's name onto the order as `vendorName`.

`src/contracts.mjs` defines the schemas. `schemas/*.schema.json` are the generated JSON Schema 2020-12
documents. Each form binds its MIME type with a `json-schema` entry, so uploaded JSON whose `$schema`
matches a Purchase schema ID is classified as that type. The schema IDs are identifiers, not hosted
endpoints.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. When you
pick **New → Purchase order**, the workspace runs `scripts/create` (Node.js, server) with the template,
the parent path and the parent's child names. Inside `/vendors` and `/purchase-orders` the script
creates the record itself, create-only, and returns its `{ path }`; the workspace opens it. Elsewhere
it returns a `{ name, content }` proposal that the workspace writes create-only with your own token.

- Records get the next code after the highest existing sibling with the same prefix (`PO-0042`).
  A code taken in the meantime moves on to the next one (up to five attempts).
- New orders default the order date to today, the expected date to the order date plus the
  `defaultLeadDays` setting, and the currency and notes from `/settings/purchase.json`.

`scripts/create/main.mjs` and `propose.mjs` are generated copies of the shared create script;
`scripts/create/config.mjs` is generated from the contracts.

## Confirming and receiving: the order script

Draft and sent orders are edited freely in their form; **Mark sent** and **Cancel order** are plain
form actions. **Confirm** and **Receive** run `scripts/post` (Node.js, server) against the saved order:

- **`confirm-order`** validates the order (dates, at least one line with a description, a named active
  vendor directly in `/vendors`), rounds each line half up to the cent, sums the rounded lines into
  `total` (BigInt minor units, never floats), snapshots `vendorName`, and marks the order `confirmed`.
  Confirmed orders are locked by their form; correct one by cancelling nothing — receive it or archive it.
- **`receive-order`** marks a confirmed order `received`. When Invoicing is installed (its `/invoices`
  container exists), it first drafts a **vendor bill** — a draft record in Invoicing's
  `application/vnd.verentis.invoicing.invoice+json` format carrying the order's lines, currency and
  vendor name, with its `reference` set to the order's path — and links it on the order as `bill`.

Integrity model: bills get deterministic names (`/invoices/PO-0001-BILL`) and are created create-only
(`If-None-Match: *`), so retries never draft twice; orders are updated conditionally (`If-Match`), so a
concurrent edit conflicts instead of being overwritten. A run interrupted between the bill and the
order write completes on retry, and already-confirmed or already-received orders return a friendly
message instead of failing.

## Cross-app contracts

Purchase requires only `verentis/canvas` and `verentis/nodejs`. `verentis/invoicing` is an **optional**
dependency: the order script only reads Invoicing's public file contract (the `/invoices` container and
its invoice vendor MIME, declared in `src/contracts.mjs`) and degrades gracefully when it is absent —
receiving simply skips the bill.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Purchases summary: vendor and order counts, value on order, browser tabs per container |
| `vendors.page.yaml` | entry point | Vendor list with contact details and payment terms |
| `orders.page.yaml` | entry point | Purchase order list by status, with a switch for received and cancelled orders |
| `vendor.form.yaml`, `order.form.yaml` | edit | Bound record forms; the order form runs the order script |
| `settings.form.yaml` | none | Edits `/settings/purchase.json` |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. The order form offers vendors from a `folder` source on `/vendors`. Unbound pages declare
`spec.access` read grants for the containers they list. Amounts in Canvas expressions are summed as
integer ten-thousandths, since expressions only have floats.

The build writes each bound document's registration fields (`entry`, `scope`, `mime-types`,
`permissions`, `capabilities`, `file-access`, `sandbox`) following the Canvas designer projection.
The `canvas-origin` packaging variable is substituted at pack time.

## Build and test

```bash
npm --workspace @verentis/app-purchase run build      # node src/build.mjs
npm --workspace @verentis/app-purchase run check      # fails when generated outputs are stale
npm --workspace @verentis/app-purchase run test:run
```

`src/build.mjs` generates `purchase.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/*` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written; `scripts/post/ledger.mjs` and the create
script are generated copies of `tools/file-apps` sources.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and order scripts.

## Known gaps

- Orders carry no partial receipts: receiving marks the whole order received.
- The drafted vendor bill reuses Invoicing's customer invoice shape (its `customer` holds the vendor's
  name); issue it from Invoicing after completing the vendor's details and dates.
- Moving or renaming a vendor breaks the path reference on draft orders; confirmed orders keep the
  `vendorName` snapshot.
