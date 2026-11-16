# Accounting

A double-entry ledger kept as JSON files in your workspace: a chart of accounts, accounting periods,
journals and paid expenses. Opening a record renders its Canvas form; Accounting folders open in the
file browser, where **New** offers the records that belong there. Posting is done by the app's
posting script, which checks every posting against the ledger before writing it.

## Workspace layout

```text
/chart-of-accounts                 application/vnd.verentis.accounting.accounts (seeded)
  ACC-0001 … ACC-0006              …accounting.account+json  (seeded starter chart)
/periods                           application/vnd.verentis.accounting.periods (seeded)
  PER-0001                         …accounting.period+json
/journals                          application/vnd.verentis.accounting.journals (seeded)
  JRN-0001, JRN-0001-R             …accounting.journal+json  (a reversal is <journal>-R)
  EXP-0001, INV-0001, …            journals posted from expenses and Invoicing (linked by `source`)
/expenses                          application/vnd.verentis.accounting.expenses (seeded)
  EXP-0001                         …accounting.expense+json
    documents/<any file>           receipts (Receipts tab)
/settings/accounting.json          …accounting.settings+json (seeded)
/applications/accounting/{canvas,schemas,templates,scripts}/   managed package assets
```

The starter chart is Bank (1000), Accounts receivable (1100), Sales tax (2100), Owner's equity (3000),
Sales (4000) and General expenses (5000), with a 15% VAT tax code on Sales tax. Seeds are installed once
and never overwritten, so edit them freely. Number prefixes and width are app settings.

## Before you post

Open **Settings** and set the **base currency** (and country, precision and fiscal year start). Posting
refuses until a base currency is set; every journal must be in it. Create a **period** covering the
posting date: postings into a closed period, or a date no period covers, are refused.

## Posting and corrections

- **Journals** are drafted with debit and credit lines, then **Post**ed. The script checks that the
  lines balance exactly, that every account exists and is active and that the period is open, then
  marks the journal posted. Posted journals are locked in their form.
- **Reverse** writes a new posted journal `<code>-R` with the lines swapped, dated on the reversal date
  (today by default) in that date's open period, and links the two. Journals posted from expenses or
  Invoicing are reversed from their source record instead.
- **Expenses** post as Dr expense (net) and Dr the tax code's account (tax), Cr the payment account
  (gross). Reversing an expense reverses its journal.
- **Periods** can be closed and reopened from their form.

Money is stored as exact decimal strings and summed as integers. A retried post never posts twice:
journals have deterministic names and are created create-only, and records are updated conditionally,
so a concurrent edit fails instead of being overwritten. The steps are not a single transaction; if a
post stops part way, posting again completes it. Immutability of posted records is enforced by the
forms and the posting script, not by storage, so anyone with write access to a file can still edit it
directly.

## Reports

The **Reports** page computes, from posted journals, a trial balance, profit and loss for a date range,
and a balance sheet at the end date (with retained earnings), plus the general ledger of posted lines.

## Workspace desktop

Accounting contributes a **Balances** widget (`accounting.balances`, default 4×4) to workspace dashboards: the
current balance of every asset, liability and equity account with posted journals (assets as debit balances,
liabilities and equity as credit balances), with asset and liability totals. It is a Canvas page
(`canvas/balances.widget.page.yaml`) that reads `/chart-of-accounts` and `/journals`; clicking a row opens the
account. Expenses have no due date, so there is no overdue-expenses widget.

## Development

`src/contracts.mjs` defines the schemas and seeds; `src/app.mjs` the manifest, entities and script
consent; `src/pages.mjs` the Canvas documents. `scripts/post/main.mjs` is the hand-written posting
script; everything else under `canvas/`, `schemas/`, `templates/`, `seed/` and `scripts/` is generated.
The committed manifest and Canvas documents are YAML while the generator still writes JSON, so `check` reports
them stale; the tests compare the generator's model with the parsed YAML instead.

```bash
npm --workspace @verentis/app-accounting run build
npm --workspace @verentis/app-accounting run check
npm --workspace @verentis/app-accounting run test:run
```
