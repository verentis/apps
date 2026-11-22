# Referrals

Employee referrals stored as JSON files in your workspace. Opening a referral renders its Canvas form. The
`/referrals` folder opens in the file browser, where **New** offers the Referral record. Referrals move
through `submitted → in-process`, then `hired` or `not-hired`; deciding them is a scripted action that
enforces the transitions and awards points from the settings. Referrals does not use the platform business
store or business commands.

## Workspace layout

Referrals names records by a generated code, without a file extension:

```text
/referrals                                application/vnd.verentis.referrals.referrals (seeded)
  REF-0001 …                              application/vnd.verentis.referrals.referral+json
/settings/referrals.json                  application/vnd.verentis.referrals.settings+json (seeded)
/applications/referrals/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The container is a
content-less typed node. Install seeds it once (`mode: seed`) and uninstall keeps it. No Canvas document is
bound to the container type, so it opens in the file browser. Inside a plain folder named like the
container, New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `referral` | `referral-code-prefix` (`REF-`) | Referrer name and optional employee reference, candidate name, optional job position reference, status `submitted / in-process / hired / not-hired`, points (non-negative integer), notes |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Referral lifecycle

Statuses: `submitted → in-process`, then `hired` or `not-hired`. The form edits the open statuses freely;
the schema requires `decidedAt` once hired or not hired, so the terminal statuses are reached only through
the action script:

- **Mark hired** (`submitted`/`in-process` → `hired`): awards the points from the Referrals settings
  (`hirePoints`, default 100) and stamps `decidedAt`; the form locks a decided referral.
- **Mark not hired** (`submitted`/`in-process` → `not-hired`): stamps `decidedAt` without awarding points;
  the form locks a decided referral.

Both actions are idempotent — re-running a finished one returns a friendly message instead of failing — and
update the referral conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Crossing the terminal statuses (marking a hired referral not hired, or the reverse) fails with a clear
error.

## Recruitment and Employees (optional)

Referrals declares optional dependencies on `verentis/recruitment` and `verentis/employees` and integrates
through file contracts only: the referral form offers job positions from `/job-positions`
(`application/vnd.verentis.recruitment.job+json`) for the job reference, and employee records from
`/employees` (`application/vnd.verentis.employees.employee+json`) for the referrer reference, with a Copy
name action. Without them, the folders are simply empty and the fields stay free-form.

## Creating records

The create script names the new record (next code). Records are written create-only (`If-None-Match: *`); a
taken name moves on to the next code. Points start at `0` and are awarded only by Mark hired.

## Pages

- **Referrals** (home): open/hired/not-hired counts, the points awarded and a file browser over
  `/referrals`.
- **Referrals by status**: every active referral, grouped by status.
- **Leaderboard**: referrers ranked by awarded points, with their referral and hire counts.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
