# Approvals

Approval types and approval requests kept as JSON files in your workspace. Opening a record renders its
Canvas form; Approvals folders open in the file browser, where **New** offers the records that belong
there (for example **Approval request** inside `/approval-requests`). Submitting, approving, refusing
and cancelling are done by the app's decision script.

## Workspace layout

```text
/approval-types                    application/vnd.verentis.approvals.types (seeded)
  APT-0001 … APT-0003              …approvals.type+json (seeded starter types)
/approval-requests                 application/vnd.verentis.approvals.requests (seeded)
  APR-0001                         …approvals.request+json (seeded sample draft request)
/settings/approvals.json           …approvals.settings+json (seeded)
/applications/approvals/{canvas,schemas,templates,scripts}/   managed package assets
```

The containers are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps
them. The MIME type, not an extension, says what a node is.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `type` (Approval type) | `type-code-prefix` (`APT-`) | Name, description, required approvers count (≥ 1) and which request fields submitting checks: amount, date, reference |
| `request` (Approval request) | `request-code-prefix` (`APR-`) | Type reference, title, requester, optional exact-decimal `amount`, optional `date` and `reference`, reason, status, the `approvals` decision trail and `decidedAt` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a
UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Unknown fields are rejected. New requests are prefilled with the default requester from
`/settings/approvals.json`.

Three starter types are seeded: **Purchase approval** (2 approvers; amount and date required),
**Travel** (1 approver; amount and date required) and **Contract sign-off** (2 approvers; reference
required), plus one sample draft request.

## Approval requests

Draft a request with its type, title, requester and reason, plus whatever details the type requires.
Requests move through `draft → submitted → approved | refused`, or are `cancelled`; each transition is
enforced by the decision script:

- **Submit** (draft → submitted) checks the title, requester and reason, then the type's required
  fields (a positive decimal amount, a date, a reference — only those the type switches on) and locks
  the form.
- **Approve** (submitted) appends `{ approver, date, decision, comment }` to the decision trail. When
  distinct approvers' approvals reach the type's required count, the request flips to approved,
  `decidedAt` is stamped and the record stays locked. The same approver cannot decide twice.
- **Refuse** (submitted → refused) needs a comment; a single refusal decides the request, whatever has
  been approved so far.
- **Cancel** (draft or submitted → cancelled) is for the requester to withdraw a request. Decided
  requests cannot be cancelled.

Re-running an operation that already happened reports it instead of failing, so retries never decide
twice.

## Pages

- **Approvals** (home): counts by status and browsers over the request and type folders.
- **Requests**: every request with its type, amount, approval progress and status; decided and
  cancelled requests are hidden behind a switch.
- **To decide**: submitted requests awaiting a decision; give your name to hide the ones you already
  decided.
- **By type**: every approval type with its threshold and its requests counted by status.

## Guarantees and limits

- Amounts are exact decimal strings in files; nothing is parsed through floating point in the script.
- Requests are updated conditionally (If-Match), so a concurrent edit conflicts instead of being
  overwritten, and already-done operations return a friendly message instead of failing.
- Submitted, approved, refused and cancelled requests can no longer be edited in their form.
- Canvas exposes no current-user identity, so the approver's name is entered by hand and cancelling is
  not verified against the requester.

## Development

```bash
node src/build.mjs            # regenerate the manifest, Canvas documents, schemas, templates, seeds and scripts
node src/build.mjs --check    # fail if any generated output is stale
npm run test:run              # vitest: contracts, pages and the decision script
```

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the hand-authored sources; everything else
under `canvas/`, `schemas/`, `templates/`, `seed/` and the generated parts of `scripts/` is written by
`src/build.mjs` (the decision script `scripts/post/main.mjs` is hand-written).
