# Original desktop fixture

Run from the Excalidraw package after `npm ci --workspaces=false`:

```sh
npm run build
mkdir -p .cache
TMPDIR="$PWD/.cache" PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright install chromium
TMPDIR="$PWD/.cache" PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npm run test:performance
npm run test:run -- --reporter=json --outputFile=tests/scenarios/desktop-1000-1440x900/outcomes/unit-tests.json
```

Playwright starts the localhost app on port 3303 and supplies the synthetic fixture
host route. `/desktop-1000-host` exists only inside the test runner interception;
it is not a public/demo product endpoint. `original.excalidraw` is portable.

`outcomes/report.json` records viewport, browser, hardware, workload, definition,
per-kind p95 targets and test boundary. Compositor evidence uses a fixed content
crop excluding cursor/toolbars. The renderer is 1440×900; readback is 720×450.
The valid scenario excludes stationary moves and settles zoom transitions.

`diagnostic-*` preserves failed early timing definitions, not acceptance evidence.
Reports preserve historical measurement evidence, not current platform readiness.
The platform owner reports native runtime source, workspace scene/replay quota and
persisted fenced retention/GC implemented. Installed two/20-client and latency,
paired Office acceptance, and ordinary publication/journal quota integration
evidence remain unexecuted; source implementation does not establish that acceptance.
No real workspace content, deployment or anonymous editing is used.
