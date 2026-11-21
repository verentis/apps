# Expenses

Expense categories and employee expense reports kept as JSON files in your workspace and posted to the
[Accounting](../accounting/README.md) ledger. Opening a record renders its Canvas form; Expenses folders
open in the file browser, where **New** offers the records that belong there. Submitting, approving,
refusing and posting are done by the app's posting script.

## Workspace layout

```text
/expense-categories                application/vnd.verentis.expenses.categories (seeded)
  CAT-0001 … CAT-0003              …expenses.category+json (seeded starter categories)
/expense-reports                   application/vnd.verentis.expenses.reports (seeded)
  EXP-0001                         …expenses.report+json (seeded sample draft report)
/settings/expenses.json            …expenses.settings+json (seeded)
/journals/EXP-0001                 journals posted to Accounting
/applications/expenses/{canvas,schemas,templates,scripts}/   managed package assets
```

Expenses requires Accounting. In Accounting, set the base currency and create an open period first. In
**Settings**, choose the reimbursement account posted reports credit (it defaults to Accounting's
starter Bank account); each category's expense account defaults to General expenses.

## Expense reports

Draft a report with the employee, the report date and its lines (category, description, exact decimal
amount and an optional line date). Reports move through their statuses by script, and each transition is
enforced:

- **Submit** (draft → submitted) checks the employee, the date and every line (a category from
  `/expense-categories`, a description and a positive amount), computes the exact total and locks the
  form.
- **Approve** (submitted → approved) records who approved it. **Refuse** (submitted → refused) records
  the reason. Draft reports can be neither approved nor refused.
- **Post** (approved → posted) validates every account against the Accounting chart of accounts and the
  report date against the open periods, then posts one journal: a debit per category expense account and
  one credit to the reimbursement account. Unapproved reports cannot be posted.

Re-running an operation that already happened reports it instead of failing, so retries never post
twice.

## Pages

- **Expenses** (home): counts by status, what is awaiting reimbursement, and browsers over the report
  and category folders.
- **Expense reports**: every report with its employee, total, status and approver; posted and refused
  reports are hidden behind a switch.
- **Expenses by category**: submitted, approved and posted report lines summed by their category.

## Guarantees and limits

- Amounts are exact decimal strings in files and BigInt minor units in the script; nothing is rounded
  through floating point.
- Journals get deterministic names (`/journals/EXP-0001`) and are created create-only, so a retried
  post never writes twice; reports are updated conditionally (If-Match), so a concurrent edit conflicts
  instead of being overwritten. A post interrupted between the journal and the report completes when run
  again.
- Reports are kept in the Accounting base currency; there is no multi-currency support.
- Submitted, approved, refused and posted reports can no longer be edited in their form.

## Development

```bash
node src/build.mjs            # regenerate the manifest, Canvas documents, schemas, templates, seeds and scripts
node src/build.mjs --check    # fail if any generated output is stale
npm run test:run              # vitest: contracts, pages and the posting script
```

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the hand-authored sources; everything else
under `canvas/`, `schemas/`, `templates/`, `seed/` and the generated parts of `scripts/` is written by
`src/build.mjs` (the posting script `scripts/post/main.mjs` is hand-written).
