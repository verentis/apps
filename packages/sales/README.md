# Sales

Products, quotations and sales orders, stored as JSON files in your workspace. Opening a Sales record
renders its Canvas form. Sales folders open in the file browser, where **New** offers the records that
belong there (for example **Quotation** inside `/quotations`). Confirming a quotation is done by a
script that computes the exact totals, creates the sales order and locks the quotation.

## Workspace layout

Any node can have content and children. Sales names records by a generated code, without a file
extension:

```text
/quotations                               application/vnd.verentis.sales.quotations (seeded)
  QUO-0001                                application/vnd.verentis.sales.quotation+json
/sales-orders                             application/vnd.verentis.sales.orders (seeded)
  SO-0001                                 application/vnd.verentis.sales.order+json
  QUO-0001                                …sales.order+json (created by confirming QUO-0001)
/settings/sales.json                      application/vnd.verentis.sales.settings+json (seeded)
/applications/sales/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers
are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No
Canvas document is bound to the container types, so they open in the file browser.

## Products

Products owns the catalogue (`/products`, `application/vnd.verentis.products.product+json`); installing Sales
installs it. Quotation lines pick its products; the confirm script checks each quoted product exists and is active.
Sales adds products only through Products' API (`create-product`, from the home page).

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `quotation` | `quotation-code-prefix` (`QUO-`) | Customer snapshot plus optional CRM `customerRef`; lines (product, quantity, unit price, discount %); `status: draft → sent → confirmed` or `cancelled`; totals, `order` and `invoice` references once confirmed |
| `order` (Sales order) | `order-code-prefix` (`SO-`) | Created by confirming a quotation (named after it) or by hand; `deliveryStatus: pending / partial / delivered` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Money and quantities are exact decimal strings (`"1350.02"`), never JSON numbers. Unknown
fields are rejected. `src/contracts.mjs` defines the schemas; `schemas/*.schema.json` are the generated
JSON Schema 2020-12 documents each form validates with.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. When you
pick **New → Quotation**, the workspace runs `scripts/create` (Node.js, server) with the template, the
parent path and the parent's child names. Inside the Sales containers the script creates the record
itself, create-only, and returns its `{ path }`; elsewhere it returns a `{ name, content }` proposal the
workspace writes with your own token. Records get the next code after the highest existing sibling with
the same prefix. New quotations default their date to today and their currency and notes from
`/settings/sales.json`.

## Confirming a quotation: the confirm script

The quotation form's **Confirm** button runs `scripts/post` (`sales-post`) with
`operation: confirm-quotation`. The script:

- refuses archived or cancelled quotations, missing customer names, dates, codes and currencies, empty
  lines, blank descriptions, zero quantities, negative prices, discounts over 100 % and zero totals;
- checks that every referenced product exists in `/products` and is active;
- computes exact totals in BigInt minor units (each line's net and discount rounded half up to the
  cent) — never floats;
- creates the sales order create-only under the deterministic name `/sales-orders/<quotation code>`,
  so retrying never creates twice; a different record at that name fails instead of being overwritten;
- when Invoicing is installed (its `/invoices` container exists), drafts an invoice at
  `/invoices/<quotation code>` in Invoicing's vendor MIME format, one invoice line per quotation line
  carrying its discounted net — also create-only and tolerated when Invoicing is absent;
- marks the quotation `confirmed` with its totals and `order`/`invoice` references, conditionally
  (`If-Match`), so a concurrent edit conflicts instead of being overwritten.

A run interrupted between the order and the quotation update completes on the next confirm. Already
confirmed quotations return a friendly message instead of failing. **Mark sent**, **Cancel** and
**Reopen** are form actions (status patches); confirmed quotations are locked by their form.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Overview stats and a browser tab per container |
| `quotations.page.yaml` | entry point | Quotations by status with the confirmed value |
| `orders.page.yaml` | entry point | Sales orders by delivery status with the order book value |
| `summary.page.yaml` | entry point | Pipeline (estimated from open quotation lines), confirmed value, open deliveries |
| `product.form.yaml`, `quotation.form.yaml`, `order.form.yaml` | edit | Bound record forms |
| `settings.form.yaml` | edit | Edits `/settings/sales.json` |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. The quotation form offers CRM customers (`/customers`, when CRM is installed) in a select with
a **Copy details** snapshot action, and products on its lines; totals are estimated in cents while
drafting and replaced by the script's exact totals on confirm. Pages sum amounts as integer
ten-thousandths because Canvas expressions only have floats. The build writes each bound document's
registration fields following the Canvas designer projection; the `canvas-origin` packaging variable is
substituted at pack time.

## Cross-app dependencies

Sales requires only `verentis/canvas` and `verentis/nodejs`. `verentis/crm` and `verentis/invoicing`
are optional: Sales never imports them at runtime, it reads/writes their public file contracts
(`/customers` with the CRM vendor MIMEs; `/invoices` with the Invoicing invoice MIME) declared in
`src/contracts.mjs`, and degrades gracefully when they are absent.

## Build and test

```bash
npm --workspace @verentis/app-sales run build      # node src/build.mjs
npm --workspace @verentis/app-sales run check      # fails when generated outputs are stale
npm --workspace @verentis/app-sales run test:run
```

`src/build.mjs` generates `sales.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is the hand-written confirm script; `scripts/create/*` and
`scripts/post/ledger.mjs` are copied from `tools/file-apps/` by the build.

## Known gaps

- Totals are kept with two minor digits; zero- and three-digit currencies are not special-cased.
- Picking a product on a quotation line stores its path but does not auto-fill the unit price; copy the
  list price by hand.
- The draft invoice carries each line's discounted net as a one-quantity line; taxes are left to
  Invoicing's own issue flow.
