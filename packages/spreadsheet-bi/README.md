# Spreadsheet BI

Saved BI dashboards and snapshots as files in your workspace. A **dashboard** is a saved set of pivot-style tile definitions; its values are
computed **live** from the record files of sibling apps (CRM customers, Invoicing invoices, Helpdesk tickets,
Accounting journals and expenses). A **snapshot** freezes one computation with exact decimal math.

## Not a spreadsheet editor

The platform's **Office integration already provides spreadsheet editing**; this app deliberately does not
build an editor, grid, or formula engine. Spreadsheet BI only stores *definitions* (which containers to
aggregate, how, and with what filters), *computes* them live in Canvas pages, and *freezes* them into snapshot
records by script. Open or edit actual spreadsheet documents with the Office integration.

## Workspace layout

| Path | Contents |
| --- | --- |
| `/bi-dashboards` | Dashboard records (`BID-0001`, …): name, description and tiles. |
| `/bi-snapshots` | Snapshot records (`BIS-0001`, …): a dashboard reference and frozen results. |
| `/settings/spreadsheet-bi.json` | The default dashboard for new snapshots. |
| `/applications/spreadsheet-bi` | The installed app: Canvas documents, schemas, templates and scripts. |

Containers and settings are seeded once and kept on upgrade and uninstall. A sample dashboard `BID-0001`
("Sales overview") is seeded with two tiles: CRM customers grouped by their `type`, and the `totals.gross`
sum of Invoicing invoices whose `status` equals `issued`.

## Tiles

Each tile aggregates one **source container** (an absolute path such as `/invoices` or `/tickets`):

- `count` — the number of active records (after the filter).
- `sum` — the sum of a **value field** (dot notation, e.g. `totals.gross`), computed from exact
  decimal-string amounts; non-numeric values are skipped with a note.
- `group-count` / `group-sum` — the same, grouped by a **group-by field** (e.g. `status`).
- An optional **filter** keeps only records whose field equals a value.

## Dependencies — all optional

Spreadsheet BI declares **optional** dependencies on CRM, Invoicing, Accounting and Helpdesk. It never
imports them: it reads their public *file contracts* (`/customers`, `/invoices`, `/journals`, `/expenses`,
`/tickets`). When an app is absent, its container is simply missing and the affected tiles are skipped with a
note — both in the live viewer and in snapshots.

## Pages

- **Spreadsheet BI** (launch): the dashboards list with counts and quick links.
- **Dashboard viewer**: pick a dashboard; every tile is computed live by Canvas expressions over the declared
  source containers (amounts summed as integer ten-thousandths). Unsupported or unavailable sources and
  non-numeric values are skipped with a note.
- **Snapshots**: every snapshot with its dashboard, status and taken time.

Dashboards and snapshots are edited through bound, schema-validated Canvas forms; records are created from
the platform "New" menu by the create script (codes `BID-`/`BIS-`, zero-padded, prefixes are app settings).

## The take-snapshot script

The snapshot form's **Take snapshot** action runs the packaged `scripts/post` script:

1. Validates the snapshot and its dashboard reference (absolute paths directly in their containers), every
   tile kind (unknown kinds are rejected) and every tile source (must be an absolute container path).
2. Computes all results with BigInt decimal-string math (never floats); missing containers and non-numeric
   values are skipped with a note on the affected result.
3. Writes the results into the snapshot, stamps `takenAt`, marks it `taken` and saves conditionally
   (`If-Match`), so a concurrent edit conflicts instead of being overwritten. The form locks taken snapshots.
4. Re-running against a taken snapshot returns a friendly message instead of recomputing — retries are safe.

## Development

```bash
node src/build.mjs          # regenerate manifest, Canvas docs, schemas, templates, seeds, script scaffolding
node src/build.mjs --check  # fail if any generated output is stale
npm run test:run            # vitest: contracts, pages (incl. live-expression evaluation), take-snapshot
```
