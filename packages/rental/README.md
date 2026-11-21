# Rental

Rental products and bookings, stored as JSON files in your workspace. Opening a Rental record renders
its Canvas form. Rental folders open in the file browser, where **New** offers the records that belong
there (for example **Booking** inside `/rental-bookings`). The booking lifecycle —
confirm → pick up → return (or cancel) — is driven by a script that validates availability, computes
exact totals and charges late fees.

## Workspace layout

Any node can have content and children. Rental names records by a generated code, without a file
extension:

```text
/rental-products                          application/vnd.verentis.rental.products (seeded)
  RPRD-0001                               application/vnd.verentis.rental.product+json
/rental-bookings                          application/vnd.verentis.rental.bookings (seeded)
  RENT-0001                               application/vnd.verentis.rental.booking+json
/settings/rental.json                     application/vnd.verentis.rental.settings+json (seeded)
/applications/rental/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers
are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps them. No
Canvas document is bound to the container types, so they open in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `product` (Rental product) | `product-code-prefix` (`RPRD-`) | Name, decimal string `dailyRate` and per-unit `deposit`, integer `quantityOwned`, `status: available / unavailable` |
| `booking` | `booking-code-prefix` (`RENT-`) | Customer snapshot plus optional CRM `customerRef`; product reference, integer `quantity`, inclusive `startDate`/`endDate`; `status: draft → confirmed → picked-up → returned` or `cancelled`; rate/deposit snapshots, exact `total`, `lateFee` and optional `invoice` reference once returned |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Money is an exact decimal string (`"1350.02"`), never a JSON number; unit counts
(`quantityOwned`, `quantity`) are JSON integers. Unknown fields are rejected. `src/contracts.mjs`
defines the schemas; `schemas/*.schema.json` are the generated JSON Schema 2020-12 documents each form
validates with.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. When you
pick **New → Booking**, the workspace runs `scripts/create` (Node.js, server) with the template, the
parent path and the parent's child names. Inside the Rental containers the script creates the record
itself, create-only, and returns its `{ path }`; elsewhere it returns a `{ name, content }` proposal the
workspace writes with your own token. Records get the next code after the highest existing sibling with
the same prefix. New bookings default their start date to today and their notes from
`/settings/rental.json`.

## The booking lifecycle: the post script

The booking form's buttons run `scripts/post` (`rental-post`) with one of four operations:

- **`confirm-booking`** refuses archived or cancelled bookings, missing customer names, codes, dates
  (`endDate` must not precede `startDate`), non-positive quantities and zero rates; checks the product
  exists in `/rental-products`, is active and `available`; counts the units reserved by *other*
  confirmed and picked-up bookings whose dates overlap and fails when owned minus reserved cannot cover
  the quantity; snapshots the daily rate and deposit from the product when the booking leaves them
  empty; and computes `total = inclusive days × rate × quantity` in BigInt minor units — never floats.
- **`pickup-booking`** moves a confirmed booking to `picked-up`.
- **`return-booking`** moves a picked-up booking to `returned`, taking an optional return date
  (defaulting to today). Days past `endDate` are charged
  `lateFee = late days × daily-late-rate × quantity` from `/settings/rental.json`. When Invoicing is
  installed (its `/invoices` container exists), it drafts an invoice at `/invoices/<booking code>` in
  Invoicing's vendor MIME format — one line for the rental, one for any late fee — create-only, so a
  retried return never drafts twice; a foreign record at that name fails instead of being overwritten.
- **`cancel-booking`** cancels a draft or confirmed booking; picked-up and returned bookings cannot be
  cancelled.

Every operation updates the booking conditionally (`If-Match`), so a concurrent edit conflicts instead
of being overwritten, and answers a friendly "already …" message when the work is done. **Reopen** is a
form action (status patch); confirmed, picked-up and returned bookings are locked by their form.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Overview stats and a browser tab per container |
| `bookings.page.yaml` | entry point | Bookings by status, sorted by start date, with a closed-bookings switch |
| `availability.page.yaml` | entry point | Per product: units owned, out today (overlapping confirmed/picked-up bookings) and available |
| `revenue.page.yaml` | entry point | Booked and returned revenue, late fees collected and deposits held |
| `product.form.yaml`, `booking.form.yaml` | edit | Bound record forms |
| `settings.form.yaml` | edit | Edits `/settings/rental.json` |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. The booking form offers CRM customers (`/customers`, when CRM is installed) in a select with a
**Copy name** snapshot action, and rental products in another. Pages sum amounts as integer
ten-thousandths and compare dates as `YYYY-MM-DD` strings because Canvas expressions only have floats
and an ISO-string `Date()`. The build writes each bound document's registration fields following the
Canvas designer projection; the `canvas-origin` packaging variable is substituted at pack time.

## Cross-app dependencies

Rental requires only `verentis/canvas` and `verentis/nodejs`. `verentis/crm` and `verentis/invoicing`
are optional: Rental never imports them at runtime, it reads/writes their public file contracts
(`/customers` with the CRM vendor MIMEs; `/invoices` with the Invoicing invoice MIME) declared in
`src/contracts.mjs`, and degrades gracefully when they are absent.

## Build and test

```bash
npm --workspace @verentis/app-rental run build      # node src/build.mjs
npm --workspace @verentis/app-rental run check      # fails when generated outputs are stale
npm --workspace @verentis/app-rental run test:run
```

`src/build.mjs` generates `rental.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is the hand-written lifecycle script; `scripts/create/*`
and `scripts/post/ledger.mjs` are copied from `tools/file-apps/` by the build.

## Known gaps

- Amounts are kept with two minor digits; zero- and three-digit currencies are not special-cased.
- Availability counts whole bookings per calendar day; same-day return-then-pickup of the same unit is
  not modelled.
- Deposits are recorded (per unit, snapshotted on confirm) but not invoiced or refunded; the drafted
  invoice carries only the rental total and any late fee, with taxes left to Invoicing's own issue flow.
