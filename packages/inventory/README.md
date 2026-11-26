# Inventory

Products, warehouses, stock moves and inventory adjustments, stored as JSON files in your workspace.
Opening an Inventory record renders its Canvas form. Inventory folders open in the file browser, where
**New** offers the records that belong there (for example **Stock move** inside `/stock-moves`).
Stock on hand is computed from done stock moves; applying an inventory adjustment emits the corrective
move that brings the stock to the counted quantity.

## Workspace layout

Records are named by a generated code, without a file extension, directly in their container:

```text
/warehouses                               application/vnd.verentis.inventory.warehouses (seeded)
  WH-0001                                 …inventory.warehouse+json
/stock-moves                              application/vnd.verentis.inventory.moves (seeded)
  MOV-0001                                …inventory.move+json
  ADJ-0001                                corrective move emitted by applying an adjustment
/inventory-adjustments                    application/vnd.verentis.inventory.adjustments (seeded)
  ADJ-0001                                …inventory.adjustment+json
/settings/inventory.json                  …inventory.settings+json (seeded)
/applications/inventory/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) together with a sample warehouse
(`WH-0001` with locations Stock, Input and Output) and a few opening stock moves of Products' sample products;
uninstall keeps them. No Canvas document is bound to the container types, so they open in the file
browser. Inside a plain folder named like a container (for example `catalog` or `moves`), New still
offers its records.

## Products

Products owns the catalogue (`/products`, `application/vnd.verentis.products.product+json`); installing Inventory
installs it. Inventory reads product files (name, SKU, unit, reorder point) and changes them only through Products'
API: the stock levels page sets a reorder point with `update-product`. A product's stock moves show on its form in
Products.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `warehouse` | `warehouse-code-prefix` (`WH-`) | Name and a list of named locations; moves into a warehouse with locations must use one of them |
| `move` | `move-code-prefix` (`MOV-`) | Product reference, quantity, from/to warehouse and location, date, reference; `status: draft \| done` with `postedAt` once done |
| `adjustment` | `adjustment-code-prefix` (`ADJ-`) | Product, warehouse, location, counted quantity, date; `status: draft \| applied` with `appliedAt` and the corrective `move` once applied |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when archived).
Quantities and reorder points are exact decimal strings (`"12.5"`), never JSON numbers. Records refer to
each other by absolute workspace path (a move's `product`, an adjustment's `warehouse`). Unknown fields
are rejected. `src/contracts.mjs` defines the schemas; `schemas/*.schema.json` are the generated JSON
Schema 2020-12 documents each form validates against.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. Inside the
Inventory containers the script creates the record itself, create-only, and returns its `{ path }`; a
taken code moves on to the next one. Elsewhere it returns a `{ name, content }` proposal the workspace
writes with your own token. New moves and adjustments are dated today, and adjustments default to the
`defaultWarehouse` from `/settings/inventory.json`.

## Posting and applying: the post script

`scripts/post` (Node.js, server) is run by the record forms:

- **`post-move`** validates a draft move — the product exists and is active, at least one side names an
  existing warehouse, a given location is one of that warehouse's declared locations, the quantity is a
  positive decimal, the date is set — then marks it `done` with `postedAt`. Posting an already-done move
  returns a friendly message instead of failing.
- **`apply-adjustment`** validates the count the same way, computes the product's on-hand quantity at the
  counted warehouse location from done moves, and emits the corrective move
  (`/stock-moves/<ADJ code>`, created create-only with `source` pointing back at the adjustment) that
  brings stock to the counted quantity — in for a surplus, out for a shortage, none when the count
  matches. The adjustment is then marked `applied` with `appliedAt` and the `move` reference.

Integrity: corrective moves have deterministic names and are created with `If-None-Match: *`, so a
retried operation never writes twice; records are saved with `If-Match`, so a concurrent edit conflicts
instead of being overwritten; an apply interrupted between the move and the adjustment completes on
retry (on-hand recomputation excludes the adjustment's own corrective move). Quantities are handled as
BigInt ten-thousandths — never floats.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Products, warehouses, draft moves and adjustments; a browser tab per container |
| `stock.page.yaml` | entry point | Stock levels: on hand per product (with reorder flags) and per warehouse, from done moves |
| `product.form.yaml` | edit | Product details plus a Moves tab with the on-hand total and move history |
| `warehouse.form.yaml` | edit | Name and locations |
| `move.form.yaml` | edit | Bound form with a **Post** action running `post-move`; locked once done |
| `adjustment.form.yaml` | edit | Bound form with an **Apply** action running `apply-adjustment`; locked once applied |
| `settings.form.yaml` | edit | Edits `/settings/inventory.json` (the default warehouse) |
| `low-stock.widget.page.yaml` | `spec.widgets` | The **Low stock** dashboard widget |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. Report arithmetic runs in the Canvas expression language, which has only floating point, so
quantities are summed as integer ten-thousandths and only divided for display. The build writes each
bound document's registration fields following the Canvas designer projection; the `canvas-origin`
packaging variable is substituted at pack time.

## Workspace desktop

Inventory contributes a **Low stock** widget (`low-stock`, default 4×4) to workspace dashboards: the
products whose on-hand quantity (from done moves, across all warehouses) is at or below their reorder
point. Clicking a row opens the product's form. It reads only `/products` and `/stock-moves`.

## Build and test

```bash
npm --workspace @verentis/app-inventory run build      # node src/build.mjs
npm --workspace @verentis/app-inventory run check      # fails when generated outputs are stale
npm --workspace @verentis/app-inventory run test:run
```

`src/build.mjs` generates `inventory.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written; `scripts/create/*` and
`scripts/post/ledger.mjs` are copies of the shared `tools/file-apps` sources.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and post scripts.

## Known gaps

- Moving or renaming a record breaks path references (a move's `product`, an adjustment's `move`).
- Canvas folder sources do not list recursively, so reports only see records directly in the containers.
- There is no reservation or lot/serial tracking; on hand is a plain sum of done moves.
