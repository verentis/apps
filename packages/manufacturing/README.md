# Manufacturing

Bills of materials and manufacturing orders, stored as JSON files in your workspace.
Opening a Manufacturing record renders its Canvas form. Manufacturing folders open in the file browser,
where **New** offers the records that belong there (for example **Manufacturing order** inside
`/manufacturing-orders`).

## Workspace layout

| Path | What lives there |
| --- | --- |
| `/bills-of-materials` | Bills of materials (`BOM-0001`, …), one JSON file per BoM |
| `/manufacturing-orders` | Manufacturing orders (`MO-0001`, …), one JSON file per order |
| `/applications/manufacturing` | The installed app: Canvas documents, JSON Schemas, templates and scripts |

Containers are seeded on install (install-once) and kept on upgrade and uninstall: your production data
outlives the app.

## Records and flows

- **Bill of materials** (`BOM-`): the product it builds (an Inventory product reference when Inventory is
  installed), the output quantity, its component lines (product reference, name, exact decimal quantity per
  output) and an optional routing (operation, workcenter, minutes). A BoM is active or archived through its
  record `state`; archived BoMs cannot be confirmed against.
- **Manufacturing order** (`MO-`): the BoM to build, the quantity to produce and the scheduled date. Orders
  move forward only: `draft → confirmed → in-progress → done`, with `cancelled` available while drafting or
  confirmed.
  - **Confirm** validates the BoM (active, positive output quantity, at least one component) and the order
    (positive quantity, scheduled date), snapshots the BoM product onto the order and computes the exact
    **component demand** (BoM component quantities × order quantity ÷ BoM output quantity, in BigInt
    ten-thousandths — never floats). Confirmed orders are locked.
  - **Start** moves a confirmed order to `in-progress` and stamps `startedAt`.
  - **Complete** moves an in-progress order to `done`, stamps `completedAt` and locks it. When Inventory is
    installed (its `/stock-moves` container exists), completion **emits done stock moves** in Inventory's
    move format: one consumption move per demand line (`MO-0001-C1`, …) out of the Inventory default
    warehouse, and one production move for the output (`MO-0001-OUT`) into it.

All quantities are exact decimal strings (`"12.5"`), never JSON numbers.

## Integrity guarantees

Emitted stock moves get deterministic names and are created create-only (`If-None-Match: *`), so a retried
completion never writes twice; orders are updated conditionally (`If-Match` ETag), so a concurrent edit
conflicts instead of being overwritten. A run interrupted between emitting moves and updating the order
completes on retry. Already-confirmed, already-started and already-done orders report a friendly message
instead of failing.

## Dependencies

- `verentis/canvas` and `verentis/nodejs` (required).
- `verentis/inventory` (optional): BoM component and output references use Inventory's product vendor MIME,
  and completing an order emits stock moves when `/stock-moves` exists. Without Inventory, the app works
  stand-alone and simply skips the moves.

## Development

Everything the platform consumes is generated from `src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs`:

```bash
node src/build.mjs            # regenerate manifest, Canvas documents, schemas, templates, seeds, scripts
node src/build.mjs --check    # fail when committed outputs are stale
npm run test:run              # vitest: contracts, pages, create and production script tests
```
