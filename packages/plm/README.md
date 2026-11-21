# PLM

Engineering change orders as plain JSON files in your workspace, moved through their review stages by script —
the file-based equivalent of Odoo PLM.

## Layout

| Path | Contents |
| --- | --- |
| `/engineering-change-orders` | One file per ECO (`ECO-0001`, …), MIME `application/vnd.verentis.plm.eco+json` |
| `/applications/plm` | Managed app files: Canvas documents, schemas, templates, scripts |

An ECO records a `title`, change `type` (`new-product`, `change`, `obsolete`), an optional `product` reference,
a `priority`, an `approver`, an `effectiveDate`, a free-form `description` and — when rejected — a
`rejectionReason`.

## Flow

`draft → in-review → approved → applied`, or `in-review → rejected` (reopenable to draft from the form).
The review script (`scripts/post`) enforces the transitions:

- **submit-review** — drafts only; requires a title. Stamps `submittedAt`.
- **approve** — in-review only; requires the `approver` field to be filled in. Stamps `approvedAt`.
- **reject** — in-review only; requires the `rejectionReason` field to be filled in. Stamps `rejectedAt`.
- **apply** — approved only; keeps a valid `effectiveDate` or stamps today. Stamps `appliedAt` and locks the ECO.

Each operation is idempotent (running it on an ECO already in the target stage reports instead of rewriting)
and conditional (If-Match), so a concurrent edit fails instead of being overwritten. The form stays editable in
draft and in-review (the approver and rejection reason are typed during review); approved, applied and rejected
ECOs are locked.

## Dependencies

- `verentis/canvas`, `verentis/nodejs` — required.
- `verentis/manufacturing` — **optional**. When installed, the ECO form offers its `/bills-of-materials` records
  in the Product / BoM select; without it the reference is typed or left empty.

## Development

```sh
node src/build.mjs          # regenerate the packaged outputs
node src/build.mjs --check  # fail if any committed output is stale
npm run test:run            # vitest
```

Hand-written sources: `src/*.mjs`, `scripts/post/main.mjs`, `tests/*.test.mjs`, `icons/app.svg`. Everything
else is generated.
