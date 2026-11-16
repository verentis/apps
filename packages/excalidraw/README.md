# Excalidraw application

`@verentis/app-excalidraw` is a standalone Nuxt 4/Vue 3 application containing a
client-only React 19 island running upstream Excalidraw 0.18. It is not the existing
Canvas dynamic-form application.

## Development and validation

Use Node ≥22.12 and npm 11.12.1 (also pinned by the Docker build). npm 10 resolves
optional peer dependencies differently and cannot consume this npm 11 lock.
From this directory:

```sh
npm ci --workspaces=false
npm run test:run
npm run typecheck
npm run build
npm run dev
```

For an owned local HTTPS AppHost, Nuxt development accepts the injected
`NUXT_HTTPS_CERT` / `NUXT_HTTPS_KEY` PEM-path pair through `devServer.https`.
Both absent preserves ordinary HTTP development; an incomplete pair fails startup
rather than downgrading to HTTP. This configures transport only, not native
admission or the default-OFF verified-target creation gate.
Vite deduplicates `react` and `react-dom` to the application-owned versions.
This prevents a hoisted upstream editor from resolving another workspace's React
instance and failing to mount, even while native SDK requests succeed.

Real browser smoke tests use Playwright, not a mocked renderer:

```sh
npx playwright install chromium
npm run test:browser
npm run test:performance
```

In environments where browser installations must remain project-local, set
`PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers"` and `TMPDIR="$PWD/.cache"` (create
`.cache` first). The native smoke test is a synthetic, host-authorized protocol
fixture with two real editor islands; it is not a production-platform acceptance
claim. `npm run test:browser:native` runs this fixture against the exact published
`@verentis/sdk@0.2.5` dependency. The app independently verifies the native,
files, lifecycle and client contracts without carrying a private SDK artifact.
No sibling checkout or development symlink is needed for install/build.
The previous CCC SDK snapshot passed 131 SDK tests; the parent additionally reports
70 relevant source-CLI tests passing. Local app reports independently verify the
new frozen archive and do not turn upstream checks into runtime authority.
After migration to the feature worktree, the parent verified all 58 package unit
tests, strict typecheck and the production build against this archive. Scenario
reports retain their historical measurements, test boundaries and then-current
gates; they are not an inventory of the current platform implementation.

The package lock is self-contained for Docker and independent installation.
The workspace host supplies authenticated workspace/file context through
`createVerentisClient`; direct browser access only explains how to open the installed
app. No browser API key or anonymous editor is exposed.

`npm run assets` copies upstream licensed fonts into the generated
`public/excalidraw-assets` directory. Build/dev run it automatically; no Google Fonts,
upstream cloud rooms or AI endpoints are required.

## Document boundary

The standard Excalidraw version 2 JSON format is authoritative. Serialization uses
`serializeAsJSON(elements, appState, files, 'local')`, retaining referenced embedded
assets and upstream-cleaned portable app state. Import rejects malformed JSON,
duplicate elements, external embeds/AI frames, missing image assets, external image
URLs and configured bounds: 10 MiB complete encoded document, 5 MiB decoded image,
10,000 elements. Workspace listing pages the unfiltered SDK source in groups of 50.
Creation uses the pinned SDK's verified create-only operation. It performs a single
`files.write(path, { content, contentType, createOnly: true })` request, with SDK
propagation of `If-None-Match: *` and atomic backend no-overwrite enforcement.
The launcher uses only that conditional operation and has no preflight GET.
Only the pinned SDK's actual `FilesModule` is admitted; an arbitrary ordinary
write method is not treated as create-only support. Its compile-time guard checks
that the SDK exposes the option. **Creation defaults disabled** until an operator
sets `NUXT_PUBLIC_CREATE_ONLY_API_URL` to the verified deployed HTTPS API base URL.
It must match the authenticated host's API base (including its path); mismatched,
unconfigured, insecure or credential/query-bearing targets are refused. Docker
defaults to the empty value; the Kubernetes template explicitly preserves it.
Only set this value after target acceptance confirms atomic precondition enforcement,
not merely source tests or the presence of a header-capable SDK.
Neither a read-before-write check nor the random filename suffix can
guarantee collision safety. There is no ordinary `files.write` fallback.
The Node operator reports the implemented multipart upload route returns HTTP 412
with ProblemDetails code `already_exists` for an existing live path or concurrent
live winner, without changing the winning head/outbox. Tombstone recreation stays
conditional through CAS retries; ordinary no-header overwrites are preserved.
Unsupported precondition values/tag lists and combinations with `X-Package-Action`
or `X-Auto-Extract` return HTTP 400. The operator verified 45 focused Node/API/golden-path
tests, including 20 concurrent creators with exactly one winner, and builds of all four regenerated workers. No generated command/entity
changes, extra storage calls or SF generation gate changes were needed.
App tests exercise the actual vendored SDK's header/path encoding and a real browser
conditional multipart upload, including HTTP 412 without retry or success navigation.
Those app tests use synthetic HTTP responses; they do not prove a deployed Node
route or grant permission to use an older backend that ignores the precondition.
Browser creation fixtures explicitly opt in only their intercepted synthetic HTTPS
API; an unmatched-target browser regression proves New stays disabled with no write.
No deployed target has been accepted by this app task.

Native collaboration uses the SDK's host-selected
`client.collaboration.join/snapshot/apply/presence/save/close` lifecycle through a
typed adapter port. Per-element operations include expected versions, presence is
ephemeral, and polling refreshes authoritative snapshots every 500 ms.
Shared state contains only the background color; grid/view preferences and image
retrieval timestamps remain local instead of causing shared-state/asset mutations.
Drawing and text gestures finish before submission so a zero-size in-progress shape cannot be
erased by an acknowledged snapshot. Same-element conflicts/disconnects pause
editing; explicit Reconnect reloads authoritative state and never merges offline
changes. Pending local edits remain visible and downloadable while frozen; the
user must confirm discarding them before reconnect reloads the authoritative scene.
Remote updates stay outside local undo history. Native operations (including
cleanup) are serialized, and late acknowledgements cannot undo a disconnect.

Autosave runs after two quiet seconds. Save is dirty until a matched durable receipt
confirms the requested generation, correlation, revision and saved frontier; newer
edits remain dirty. A separate local generation is checked against its current
value, while server accepted `sequence` and durable `savedSequence` remain distinct.
Native results have no WOPI `state` wrapper and do not use generic WOPI document
metadata validation to establish authority. Whole-file writes are not an editing fallback. The vendored
SDK includes the typed native bridge; actual platform admission remains a release
requirement on each target. An isolated signed-installed target has demonstrated
admission and durable saves; a host without native admission leaves the editor read-only.

**Current platform implementation and release gates:** the platform owner reports
implemented native consent and the verified `nativeEnabled` producer, six native
routes, persisted native/WOPI-exclusive document ownership, a 20-tab connection
cap, atomic Node saves, immutable receipts, recovery/revocation and private
scene/replay storage. Persistence metadata and C# were manually aligned under
explicit approval; no Software Factory run is claimed. SF licensing or generation
is not a blocker to this authorized implementation.

**Parked showcase handoff (2026-10-08):** the genuine signed-installed two-tab
journey passes editor mounting, independent imports, durable ordinary Node file
bytes and immutable save-receipt replay using the integrity-pinned source-built
`verentis-sdk-0.2.0-dd1dccceebef.tgz`, not a published compatible SDK release.
Installed API evidence separately covers conflicts and viewer write denial.
Temporary scene/replay accounting is asynchronous in the existing maintenance
worker; admission and publication make no quota RPCs. Background accounting
records overage, and new enforcement is deferred. Persisted retention/GC and
terminal retirement prevent delayed writes or accounting from resurrecting
released objects. Ordinary Node ingress/egress retains its existing cached
gate and head/outbox path. The platform's 104 focused storage/read/write checks
pass; this does not establish mixed-workload performance.

The hosted container listens on unprivileged port 8080 so it can run as UID 65532
with a read-only root filesystem and all capabilities dropped. The named Service
target and probes use that container port; the Service remains on port 80 behind
the existing HTTPS ingress.

Current Libre Office framing and seven browser boundary checks pass. Both real
local installed Office journeys also pass: all seven core outcomes cover the
new pre-install consent flow, ordinary upload, CODE edit/durable save,
distinct-user coauthoring, reopen and administrator API revocation; all six
operations outcomes cover rename, Save As, exact derived-target continuation
and target-only persistence. Marketplace editor approval now requests its missing
administrator scope, and the CLI uses Security's generalized resource target.
Neither correction changes ordinary Node ingress/egress.
An earlier Save As attempt hit a genuine Cosmos concurrency failure during
derived admission. It did not recur in the final run, but no race fix or
production-readiness claim is made. Libre Office's `docs/verification.md` and the
platform contract preserve that risk and distinguish API revocation coverage from
Marketplace UI coverage. The owned warm runtime is stopped.
Final-state Excalidraw screenshot readiness also warns during snapshot polling;
functional results are retained without relaxing deadlines.

At the user's request, scaling/twenty-client latency, native restart/revocation
acceptance, launcher file creation/general-platform agent capabilities and
compatible release publication are deferred. This is demonstrated showcase
functionality, not production or release readiness. Signed installation, exact
administrator native consent and real target verification still apply; do not
enable editing through success stubs or reinterpret WOPI proof as native authority.
Readiness and the launcher's verified-target creation gate remain default-OFF.

The implemented host RPC adapter retains backend
session/epoch and verified parent document binding, rejects wrong-source/opaque/
stale bridges, and validates generation/correlation/durable captured frontier.
Its `ApplyVersioned` reducer mapper supports SDK element `expectedVersion` without
a child-supplied revision map. The Resource resolver now produces verified
`installation.nativeEnabled`; a manifest declaration or incoming hint alone
cannot enable admission. Missing proof, authority or readiness still fails closed.
The authenticated host rejects a fifth pending operation with typed `UNAVAILABLE` instead of queuing
a server call; native HTTP calls time out after 30 seconds. This app schedules at
most one native request and skips polls/presence while save/apply is active, rather
than relying on either four-request cap as a scheduler.

The platform implements signed native publication enforcement
using existing Marketplace `ManifestYaml`, the real Ed25519 verification path,
active signer/publisher checks and explicit-consent classification. Separate
Resource native-consent persistence and Node head-ETag epoch/connection/payload
fencing are implemented, including authentication-bound operation/save
deduplication. Publication enforcement does not require a WOPI/hosted backend or
bypass native administrator consent. The host preserves the authenticated
backend's immutable opaque receipt revision instead of comparing it with or
rewriting it to the latest coauthor head; retries retain the original captured
frontier/generation. Malformed revisions, insufficient frontiers, private binding
and stale-frame guards remain enforced.

The parent-selected app bridge contract is `join/snapshot/apply/presence/save/close`;
it matches the implemented adapter. Native HTTP fencing, server session/epoch,
installation/document identity and conditional Node commit identities stay behind
the trusted parent mapper. The child never supplies those authority bindings.
`sequence` and `savedSequence` map to accepted/durable server frontiers; receipt
`revision` identifies the actual committed Node revision.

The finalized backend join privately returns
`{ sessionId, connectionId, epoch, documentBinding, snapshot }`. Each backend
operation carries the host-retained `connectionId` and `epoch`; the SDK-facing
schema is unchanged. Public `participants.id` is an opaque per-connection presence
ID, never a principal or display name; the editor preserves separate entries for
two tabs with the same name. The frozen SDK rejects duplicate connection presence
IDs, while app protocol tests verify valid distinct-tab identities and reject
obsolete snapshots, unsafe sequences and empty revisions.
The room limit is 20 active editor connections, not distinct
principals: two tabs have separate handles, and close removes only its own handle.
The host keeps an admission `acquisitionId` stable across uncertain retries;
server deduplication binds it to the same frame/principal/document/installation.
Connection slots require CAS under the deterministic document
lease/mode/installation/epoch. These are implemented platform obligations; the
app's synthetic fixtures do not verify an installed target. The host
may retain frontier metadata, never cached scenes: each returned scene must come
from a newly authorized backend operation, including polls and other responses.
The app discards snapshots that regress accepted or durable sequence; a regressing
change acknowledgement instead pauses editing and retains the unconfirmed draft.
Read-only revocation still freezes editing even when its scene is discarded.

The canonical SDK save is `save(generation, correlation)`, returning the full
snapshot plus exactly `receipt: { generation, correlation, revision }`. The host
captures `throughSequence` privately, validates backend durable proof and requires
`savedSequence` to reach that captured frontier. The app matches the requested
generation/correlation and requires a nonempty opaque immutable receipt revision,
then checks its current local generation before clearing dirty. A later coauthor
durable head can make the latest snapshot's revision differ from that confirmed
captured commit; equality between those revisions is not a save condition.
The host privately verifies the persisted captured frontier, and the app keeps
its local-generation fence and durable-frontier check.
SDK generation is an independent
monotonic save-attempt correlation counter, never the accepted scene revision:
repeated saves of the same scene issue distinct generations. The app separately
captures its accepted frontier and requires `savedSequence` to reach it; a
matching attempt receipt alone cannot confirm a lower durable frontier.
Sequences, versions and SDK
generations are nonnegative JavaScript safe integers; revision is a nonempty
opaque string, not a numeric counter, GUID or hash. No backend session, epoch,
element revision map, Node version or content identity is exposed in SDK results.

`expectedVersion` is the upstream element version at the local intent baseline.
Null means insert-only, including against a tombstoned ID. The host's reported
`ApplyVersioned` mapper validates that expected version against the authoritative
stored element before deriving its private server revision; it must not substitute
the latest server version for a stale intent. Updates must strictly increase the
stored upstream version; equal or non-monotonic versions are rejected. The future
room CAS must fence the same validated snapshot and never rebase a rejected batch.
Deletion may send a complete
`isDeleted: true` element with an increased version or `element: null`, which makes
the server increment the stored tombstone version. Native baselines retain
tombstones and embedded asset records; tombstones count toward the 10,000 limit.
Never-submitted, already-deleted creations produce no new insert operation.
Portable downloads still use the unchanged upstream local serializer, which
prunes deleted elements; this does not prune tombstones from native room state.

**Background CAS continuation:** the finalized public contract adds
`appStateExpectedSequence` to `NativeChangeSet`, mandatory whenever `appState` is
provided and forbidden otherwise. It is a nonnegative safe integer captured from
the snapshot actually applied before local background intent/gesture began.
The app preserves that baseline through pending edits, newer polls, preceding
apply acknowledgements and local reverts; it never substitutes the latest known
sequence. Unchanged background state omits both fields.
The host forwards the token unchanged. The backend compares it atomically with
the current global accepted sequence before any mutation; even an intervening
element edit conservatively conflicts. A rejected batch pauses editing, explains
the background conflict and retains the local color/elements for download;
reconnect requires explicit discard rather than silently applying the winner.
Paused downloads use the retained draft rather than a potentially stale imperative
React scene. Only an interrupted interaction needs an additional scene capture.
The previous proposed app-state revision-map fields are superseded.
Focused continuation evidence is in `tests/scenarios/native-scene-cas/outcomes/`:
50 collaboration/SDK/create-only unit tests and two Chromium flows pass, including retained
background download/discard recovery and read-only embedded-image PNG export;
strict typecheck and production build pass. The browser host is synthetic, not
proof of live platform CAS. The pinned `dd1dccceebef` SDK includes the exported
type and runtime validator. Actual SDK tests verify unchanged captured-sequence
forwarding and reject missing, negative, fractional, nonfinite, unsafe and unpaired
baselines. Both package and workspace locks verify the provided archive integrity;
only the workspace's Excalidraw manifest and nested SDK lock entries changed.

## Workspace desktop

- **Recent boards** widget (`excalidraw.recent`, route `/widgets/recent`, default 4×4): the most recently changed
  `.excalidraw` boards, as many as fit the tile, each with its folder and age. Clicking a board opens it in its own
  window (`bridge.openWindow({ path })`; hosts without windows navigate instead); **All boards** opens the launcher.
  The SDK has no listing by MIME type or modification date, so the widget lists the workspace root (where the
  launcher creates boards) plus a `files.search('excalidraw')` name/path search, then filters and sorts by
  `updatedAt` itself; boards elsewhere whose names do not match the search are not shown. It refetches on `files`
  live hints for boards (debounced) and on `reconnected`. While the dashboard is being arranged it starts no work.
  It applies the host theme (`verentis:theme`).
- **Menus** (`spec.menus`): *Board* → Save, Download document, Export PNG, Export SVG; *View* → Zoom to fit.
  An open board registers these commands (`bridge.registerCommand`) while its window is focused and removes them
  when it loses focus, so the menu bar acts on the focused board.

Permissions are unchanged (`file.read`, `file.write`). Local development: `npm run dev` serves
`http://localhost:3303` (HTTPS with `NUXT_HTTPS_CERT`/`NUXT_HTTPS_KEY`); `environments/local.yaml` points the
manifest at `https://excalidraw.apps.localtest.me`.

## Packaging and hosting

The application manifest declares the workspace launcher and dedicated MIME/extension
handler (never a generic JSON handler). Environment overlays select the iframe URL.
Build the Docker image using this package directory as its context. Kubernetes
Deployment/Service/Ingress use `__APP__`, `__NAMESPACE__`, `__IMAGE__`, `__HOST__`,
`__TLS_SECRET__` tokens; do not deploy until native capability admission and signed package validation
are enabled in the target platform. Package-local readiness is not collaboration
service readiness. The target host must honor `allow-downloads` in the sandbox;
manifest validation alone does not prove download permission or native admission.
The agreed application-only declaration is the exact one-key object
`spec.collaboration: { mode: native-scene-v1 }`, with existing `file:read` /
`file:write` capabilities and `file.read` / `file.write` permissions.
It is mutually exclusive with `spec.wopi` and adds no native permission scope or
operator/backend configuration. Read-only handlers need only `file:read` and
`file.read`. CLI validation must reject null, extra keys and unknown modes.
Both HTTPS overlays passed the parent source-built CLI. Negative checks reject null,
extra keys, unknown modes and combined WOPI. Its 13 focused native tests and 57
pack/development compatibility tests passed upstream. The older published CLI
incorrectly accepts malformed declarations, so it cannot substitute for the updated
validator during package/release validation.
The signed declaration and exact administrator native consent/proof are both
required for `nativeEnabled`: file-write consent, MIME association and existing
WOPI capability snapshots cannot authorize native rooms. The platform implements
native consent and persisted authority, but verified installation, administrator
consent and target readiness remain necessary; declaring intent does not enable rooms.

Local unsigned packaging and digest verification also passed with the source CLI.
The validation package and versioned report are preserved under
`tests/scenarios/native-manifest/outcomes/`: two HTTPS overlays, five malformed
native declaration variants, exact packed intent/least-privilege permissions and
archive digests are checked. As a hosted application it has no runtime payload and
six plaintext catalog files; Docker ships the Nuxt server separately.
This unsigned evidence is not a developer signature, installation, deployment or
native authority proof and must not be used as one.

The upstream Excalidraw dependency is MIT-licensed; fonts have their own MIT/OFL
notices under `licenses/`. The copy step substitutes OFL Liberation Sans 2.1.5 for
the upstream package's GPL-era 1.05 face. Notices are served alongside the fonts.
No upstream engine fork or proprietary document envelope exists.

## Desktop performance acceptance

`performanceFixture()` and the browser scenario share exactly 1,000 original
synthetic rectangles in a 40×25 grid. `npm run test:performance` uses Chromium
desktop at **1440×900**, DPR 1, after fonts/load settle. The engineering target is
**p95 input-to-next-paint ≤100 ms**, checked separately for pan and zoom as well as
combined inputs. Trusted inputs are paired with actual changed document-content
compositor frames, not a two-rAF opportunity proxy or hardware display telemetry.
JPEG evidence readback is downsampled to 720×450 to limit capture overhead; the
renderer remains 1440×900. Stationary pointer events are excluded.

Scenario-local evidence is preserved under
`tests/scenarios/desktop-1000-1440x900/outcomes/`: JSON report and samples, compressed
renderer trace, before/after images and native Vitest boundary-test output. No shared
scenario harness/report format exists in this package; the versioned JSON report
documents environment, workload, checks, metrics, evidence and test boundaries.

Validated on 2026-10-04: headless Chromium **153.0.8010.12**, Linux kernel
7.2.7-200.fc44.x86_64, Intel i7-6700K, 8 available logical CPUs, 33,593,786,368 bytes
RAM, Node 24.14.0, no CPU throttling. Across **278 confirmed paints** (240 pan,
38 zoom), p95 was **61.9 ms combined**, **46.1 ms pan**, **80.1 ms zoom**.
Failed harness diagnostics remain labeled separately; they counted stationary
post-zoom moves and required static redraw when compositor transforms also paint.

The measured real React renderer is read-only with a synthetic local host/file
fixture. Neither this scenario nor the two-island mock bridge establishes genuine
installed-platform multiplayer. Separate installed two-tab and real Office
journeys establish the functional acceptance described above, not this fixture's
multiplayer latency. The native runtime includes asynchronous temporary-state
accounting and fenced retention/GC; genuine 1,000-element multiplayer latency
and mixed-workload quota/performance measurements remain deferred. The fixture
host URL is test-runner-only, not an anonymous application demo.
