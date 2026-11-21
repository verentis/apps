# Verentis applications

Reusable Verentis applications and public reference implementations. Every directory under `packages/`
is an independently versioned, validated, and published package root. Hosted apps
are deployed separately; Canvas-backed business packages contain declarative assets.

| Package | Demonstrates |
| --- | --- |
| `image-viewer` | Minimal read-only iframe application and media resource handling. |
| `markdown-viewer` | Safe content rendering and file-type registration. |
| `smart-editor` | Rich editing, write access, and broader SDK integration. |
| `crm` | File-based customers/pipeline: vendor-MIME JSON records, seeded containers, bound Canvas forms and creatables. |
| `accounting` | File-based double-entry ledger: accounts, periods, journals and expenses posted by script, with trial balance, P&L and balance sheet pages. |
| `invoicing` | File-based invoices, credit notes and payments issued to the Accounting ledger by script, with CRM customer copy and receivables. |
| `sales` | Sales: products, quotations and sales orders; a quotation is confirmed into a sales order by script. |
| `rental` | Sales: rental products and bookings, confirmed, picked up and returned by script. |
| `purchase` | Supply chain: vendors and purchase orders, confirmed and received by script, with draft vendor bills handed to Invoicing. |
| `inventory` | Supply chain: products, warehouses, stock moves and adjustments, validated and applied by script. |
| `manufacturing` | Supply chain: bills of materials and manufacturing orders, confirmed, started and completed by script, with stock moves handed to Inventory. |
| `plm` | Supply chain: engineering change orders, submitted, approved, rejected and applied by script against Manufacturing BOMs. |
| `quality` | Supply chain: quality control points, checks and alerts, recorded against tolerances and resolved by script. |
| `maintenance` | Supply chain: equipment and maintenance requests moved through stages by script, keeping equipment status in sync. |
| `fleet` | Supply chain: vehicles, fleet contracts and service logs, validated and posted by script. |
| `employees` | HR: departments and employees with a company directory, organization summary and scripted terminate action. |
| `time-off` | HR: leave types and requests with weekday-counted days, scripted submit/approve/refuse and a remaining-allocation report. |
| `recruitment` | HR: job positions and candidates with a hiring pipeline and scripted advance, refuse and hire actions. |
| `appraisals` | HR: employee appraisals with criteria ratings, computed overall score and scripted schedule/complete actions. |
| `referrals` | HR: employee referrals with a points leaderboard and scripted hire decisions that award points. |
| `payroll` | HR: region-agnostic payroll engine — salary structures, pay profiles and pay runs computed and posted to the Accounting ledger by script. |
| `project` | Services: projects and tasks with a stage board and a Complete action script. |
| `timesheets` | Services: timesheet entries logged against Project work and validated by script. |
| `helpdesk` | Services: support teams and tickets with SLA deadlines, a stage pipeline and scripted resolve/close. |
| `field-service` | Services: field tasks — schedule technicians, log hours and materials on site, draft invoices for completed work. |
| `planning` | Services: shift planning with roles, a week schedule, overlap-checked publishing and locked confirmed shifts. |
| `appointments` | Services: appointment types with durations and buffers, and bookings with conflict-checked confirmation. |
| `events` | Marketing: events and registrations with capacity tracking, a publishing lifecycle and scripted confirm/check-in. |
| `surveys` | Marketing: surveys and responses with validated questionnaires, scripted open/close/submit and a results summary. |
| `social-marketing` | Marketing: social accounts and posts with scripted schedule/publish/cancel; network delivery is a platform integration concern. |
| `knowledge` | Productivity: spaces and Markdown articles nested into a hierarchy, published, archived and restored by script. |
| `approvals` | Productivity: approval types and requests, submitted, approved, refused or cancelled by script with multi-approver thresholds. |
| `documents` | Productivity: tagging and review workflow over existing workspace files, moved through inbox/review/validated/archived by script. |
| `discuss` | Productivity: discussion channels and threaded messages as a durable record with scripted post, resolve, lock and archive; realtime delivery is the platform's concern. |
| `spreadsheet-bi` | Finance: saved BI dashboards and snapshots computed live from the record files of CRM, Invoicing, Accounting and Helpdesk. |
| `expenses` | Finance: expense categories and employee expense reports, submitted, approved and posted to the Accounting ledger by script. |
| `excalidraw` | Infinite-canvas diagrams and wireframes, portable Excalidraw files, and a platform-native collaboration adapter; installed multiplayer release acceptance remains gated. |

Run a command across all JavaScript workspaces from the repository root:

```bash
npm install
npm run test
npm run build
```

Package-specific commands can be run with `npm --workspace @verentis/app-image-viewer run test:run` or
from the package directory. Marketplace commands must target the owning package root.

CRM, Accounting and Invoicing are file based: records are vendor-MIME JSON files in seeded workspace
containers, edited through bound Canvas forms and named by a nodejs create script. Each package authors its
schemas, manifest and Canvas documents in `src/` and generates them with `node src/build.mjs` (`--check` fails
when a generated file is stale). Accounting and Invoicing share build-time helpers under `tools/file-apps`
(schema, Canvas, build, create-script and ledger helpers, copied into each package's scripts); they are
development tooling, not an app. Their posting scripts (`scripts/post`) validate against the chart of accounts
and open periods, write journals idempotently and mark records posted or issued, which then lock in their forms.
All three depend on the `latest` Canvas and nodejs engine; Invoicing also depends on Accounting and optionally CRM.
The same file-based pattern now spans the whole business suite — Sales (sales, rental), Supply Chain
(purchase, inventory, manufacturing, plm, quality, maintenance, fleet), HR (employees, time-off, recruitment,
appraisals, referrals, payroll), Services (project, timesheets, helpdesk, field-service, planning, appointments),
Marketing (events, surveys, social-marketing), Productivity (knowledge, approvals, documents, discuss) and
Finance (expenses, spreadsheet-bi) — each a Canvas UI over vendor-MIME JSON files with nodejs action scripts
and no custom runtime dependencies. Email/SMS campaign delivery and marketing automation are deliberately
deferred to the platform notification service design.

Excalidraw is a wrapper around the upstream MIT-licensed editor, not the platform's existing Canvas
dynamic form renderer. It is an installed, authenticated workspace application, not an anonymous
public demo. The matching platform implements native consent/nativeEnabled, persisted exclusive
ownership, atomic saves/immutable receipts and recovery/revocation with private storage.
Metadata and C# were manually aligned under approval; no Software Factory run is claimed.
Temporary scene/replay accounting is asynchronous in the maintenance worker, with persisted
epoch/reference/in-flight-fenced retention/GC and leased zero-byte tombstones against delayed
resurrection. Signed-installed two-tab edit/save/replay and both real local Office Playwright
journeys pass, using the current pre-install consent flow. An earlier intermittent Office
Save As concurrency failure remains documented without a claimed fix. Twenty-client latency,
mixed-workload performance, native restart/revocation and compatible publication remain deferred.
This is not yet a verified
installed multiplayer release, and the app's verified-target creation gate stays default-OFF.
Collabora's internal coauthoring remains separate. See `packages/excalidraw/README.md` for the format,
limits, integration and verification instructions. Repository visibility remains governed by
`OPEN_SOURCE_READINESS.md`.

## Delivery

Delivery is trunk based and follows the shared contract in `verentis/.github` (`docs/app-delivery.md`):

- A pull request from a branch in this repository deploys each changed hosted app to the internal `feature`
  environment as `<name>-pr-<n>.<apps domain>` and publishes each changed package to the feature registry as a
  `-pr.<n>` prerelease. Closing the pull request removes the preview copies.
- A merge to `main` runs no tests: it builds each changed hosted app once and deploys the same image directly to
  each production region in turn; each changed package is then published to the global production registry.
  **Run workflow** on `Release` with `everything` ships every package and hosted app.

Hosted apps (Image Viewer, Markdown Viewer, Smart Editor and Excalidraw) are declared in
`.github/verentis-delivery.json` with their Dockerfile, `k8s/deployment.yaml` template and health check. CRM,
Accounting and Invoicing are package-only; they need compatible, published runtime/backend dependencies before
activation. `node --test .github/tests/delivery-config.test.mjs` checks the classification, templates and overlays.

Each package has `environments/local.yaml`, `environments/feature.yaml` and `environments/production.yaml`. Feature
hosts are supplied at publish time: hosted apps use `https://${param:app-host}`, and CRM, Accounting and Invoicing
point at `https://canvas.${param:apps-domain}`. Production hosts are region-free (`https://<name>.apps.verentis.io`).
Versions come from GitVersion (the shared `verentis/.github` `resolve-version` action, configured by `GitVersion.yml`
at the repository root), the same way the Verentis CLI and SDK are versioned: one version per release, the last
`v<version>` tag plus one patch, and the release tags its commit `v<version>` (re-running the same commit gives the
same version). Pull request previews are `<next version>-pr.<n>.<run>.<attempt>`, which sorts below the release that
merges them. `metadata.version` in the manifests is not used at publish time and nothing is written back to the
repository. To release a new minor or major, push a tag such as `v1.3.0` on the last released commit, or put
`+semver: minor` / `+semver: major` in the merge commit message. Package assets are built with `npm run build`
before packing.

Azure, cluster and registry settings, the publisher signing key and the Cloudflare Access token come from the
repository's `feature`, `production-<region>` and `production` GitHub environments, created by the platform's
repository bootstrap. Missing trust, secrets or signing prerequisites block delivery; do not substitute a human
API key or unsigned packaging.
