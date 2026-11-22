# Payroll

A **region-agnostic payroll engine**: salary structures, pay profiles and pay runs kept as JSON files
in your workspace and posted to the [Accounting](../accounting/README.md) ledger. There are **no
country-specific tax tables built in** — every earning, deduction and employer contribution is a rule
you define as data in a salary structure. Opening a record renders its Canvas form; Payroll folders
open in the file browser, where **New** offers the records that belong there. Computing, approving and
posting are done by the app's pay run script.

## Workspace layout

```text
/salary-structures                 application/vnd.verentis.payroll.structures (seeded)
  PAYSTR-0001                      …payroll.structure+json (sample structure, seeded)
/pay-profiles                      application/vnd.verentis.payroll.profiles (seeded)
  PAYEMP-0001, PAYEMP-0002         …payroll.profile+json (sample profiles, seeded)
/pay-runs                          application/vnd.verentis.payroll.payruns (seeded)
  PAYRUN-0001                      …payroll.payrun+json (sample draft run, seeded)
/settings/payroll.json             …payroll.settings+json (seeded)
/journals/PAYRUN-0001              one journal per posted pay run, in Accounting
/applications/payroll/{canvas,schemas,templates,scripts}/   managed package assets
```

Payroll requires Accounting. In Accounting, set the base currency and create an open period first. In
**Settings**, map the posting accounts: wage expense and employer contribution expense default to the
starter chart's General expenses; the payable accounts (deductions, net wages, employer contributions)
must be chosen before posting. With [Employees](../employees/README.md) installed (optional), a pay
profile can link its employee record; without it, the employee name on the profile is all the engine
needs.

## Salary structures

A structure is an ordered list of rules — the engine's only taxonomy is the rule **kind**
(`earning`, `deduction`, `employer-contribution`) and its **computation** (`fixed` amount or
`percent-of-base`); what a rule *means* (tax, pension, bonus, levy…) is your data, so the same engine
serves any region. The seeded sample holds a 100% base-salary earning, an example 10% deduction and an
example 5% employer contribution. Rules apply in sequence order; rates and amounts are exact decimal
strings.

## Pay profiles

One per employee: name, optional Employees record link, the salary structure, the base monthly wage
(exact decimal string) and the currency (defaults to the Accounting base currency). Inactive profiles
are skipped when a run is computed.

## Pay runs

A pay run pays one `YYYY-MM` period and moves **draft → computed → approved → posted**; the script
enforces the transitions and every operation is idempotent.

- **Compute** (draft or computed) builds one payslip per active profile from its structure's rules with
  exact BigInt minor-unit arithmetic — percent-of-base amounts are rounded **half up** to the
  currency's minor unit — and stores the payslips inline with gross, deductions, employer
  contributions and net totals. Computing again replaces the payslips.
- **Approve** (computed) marks the run ready to post.
- **Post** (approved) validates the chart of accounts and the open period covering the period's last
  day, then writes **one balanced journal** create-only under `/journals/<run code>`:
  Dr wage expense (gross) and employer contribution expense, Cr deductions payable, net wages payable
  and employer contributions payable. The run is then locked — its form can no longer be saved.

## Guarantees and limits

- Money is carried as exact decimal strings in files and BigInt minor units in the script — never
  floating point. Rounding is half up at the minor unit.
- Journals get deterministic names and are created with `If-None-Match: *`, so retrying never posts
  twice; records are saved with `If-Match`, so a concurrent edit conflicts instead of being
  overwritten. A post interrupted between journal and record completes on retry.
- Single currency: pay runs are kept in the Accounting base currency.
- The engine ships no statutory logic. Progressive tax bands, caps or thresholds are not expressible
  as a single rule — model them as separate rules or precompute them into fixed amounts.

## Development

```bash
node src/build.mjs            # regenerate manifest, Canvas docs, schemas, templates, seeds, scripts
node src/build.mjs --check    # fail if committed outputs are stale
npm run test:run              # vitest: contracts, pages, compute/approve/post flow
```

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; everything else under
`canvas/`, `schemas/`, `templates/`, `seed/` and the generated script files is build output. The
hand-written pay run script lives in `scripts/post/main.mjs`.
