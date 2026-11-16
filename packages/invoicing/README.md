# Invoicing

Invoices, credit notes and payments kept as JSON files in your workspace and posted to the
[Accounting](../accounting/README.md) ledger. Opening a record renders its Canvas form; Invoicing
folders open in the file browser, where **New** offers the records that belong there. Issuing and
posting are done by the app's posting script.

## Workspace layout

```text
/invoices                          application/vnd.verentis.invoicing.invoices (seeded)
  INV-0001                         …invoicing.invoice+json
    documents/INV-0001.md          the issued copy (Markdown), plus any other documents
/credit-notes                      application/vnd.verentis.invoicing.credits (seeded)
  CN-0001                          …invoicing.credit+json
    documents/CN-0001.md
/payments                          application/vnd.verentis.invoicing.payments (seeded)
  PAY-0001                         …invoicing.payment+json
/settings/invoicing.json           …invoicing.settings+json (seeded)
/journals/INV-0001, CN-0001, PAY-0001, PAY-0001-R   journals posted to Accounting
/applications/invoicing/{canvas,schemas,templates,scripts}/   managed package assets
/.workspace/desktop/apps/invoicing/invoice-follow-up.layout.yaml   managed window layout
```

Invoicing requires Accounting. In Accounting, set the base currency and create an open period first.
In **Settings**, enter your seller details; the posting accounts default to Accounting's starter chart
(Accounts receivable, Sales, Sales tax and Bank), payment terms to 30 days and tax to 15%.

## Invoices

Draft an invoice with its customer, dates and lines (quantity, unit price and tax %; an empty tax rate
takes the default). With CRM installed, choose a CRM customer and **Copy details** to fill in the
customer; the invoice keeps its own copy, so later CRM edits do not change it.

**Issue** computes exact totals (each line's net and tax rounded half up to the cent), posts
Dr Accounts receivable, Cr Sales and Cr Sales tax, snapshots your seller details, writes a Markdown copy
under the invoice and locks it. Correct an issued invoice with a credit note.

## Credit notes and payments

- A **credit note** is against an issued invoice and can be at most what is still outstanding on it.
  Issuing posts Dr Sales and Sales tax, Cr Accounts receivable, and writes its own Markdown copy.
- A **payment** posts Dr the bank account, Cr Accounts receivable. Its allocations settle issued
  invoices, each up to what is outstanding; anything unallocated stays on account. **Reverse** posts a
  reversing journal and releases the allocations.

The **Receivables** page lists issued invoices with what has been credited, paid and is outstanding,
and which are overdue.

## Workspace desktop

- **Invoices due** widget (`invoicing.invoices-due`, default 4×4): issued invoices with something outstanding,
  earliest due date first, with customer, outstanding amount and an overdue marker. It is a Canvas page
  (`canvas/due.widget.page.yaml`) that reads `/invoices`, `/credit-notes` and `/payments`; clicking a row opens
  the invoice.
- **Invoice follow-up** window layout (`desktop/invoice-follow-up.layout.yaml`): CRM customers in a 400px zone
  beside Invoicing receivables. It is installed (managed) to `/.workspace/desktop/apps/invoicing/`; users save a
  copy to change it. The CRM window needs CRM installed.

## Guarantees and limits

Money is stored as exact decimal strings and summed as integers. A retried issue or post never posts
twice: journals have deterministic names and are created create-only, and records are updated
conditionally. The steps are not a single transaction; if one stops part way, running it again completes
it. Issued and posted records are locked by the forms and the posting script, not by storage. Invoices
are not emailed or rendered to PDF; share the Markdown copy, or attach your own documents.

## Development

`src/contracts.mjs` defines the schemas and seeds; `src/app.mjs` the manifest, entities and script
consent; `src/pages.mjs` the Canvas documents. `scripts/post/main.mjs` is the hand-written posting
script; everything else under `canvas/`, `schemas/`, `templates/`, `seed/` and `scripts/` is generated.
`desktop/` is hand-written. The committed manifest and Canvas documents are YAML while the generator still writes
JSON, so `check` reports them stale; the tests compare the generator's model with the parsed YAML instead.

```bash
npm --workspace @verentis/app-invoicing run build
npm --workspace @verentis/app-invoicing run check
npm --workspace @verentis/app-invoicing run test:run
```
