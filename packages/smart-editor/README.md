# Verentis Smart Editor

Installer-facing listing: [Marketplace README](marketplace/README.md). Development documentation continues below.

A Monaco-powered text editor supporting JSON, YAML, Python, JavaScript, and more — runs inside the Verentis workspace iframe.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start development

```bash
cp .env.example .env
# Edit .env with your API URL and key (only needed for standalone dev)
npm run dev
```

The dev server starts at [http://localhost:3302](http://localhost:3302).

## How It Works

The `useVerentis()` composable auto-detects the environment:

- **iframe mode**: Communicates via PostMessage to receive context from the workspace host.
- **Standalone mode**: Uses the API key from `.env` to authenticate directly.

## App Manifest

Save is registered with SDK 0.2 and rendered exclusively in the workspace header. Ctrl/Cmd+S inside
the editor uses the same save handler. Failed writes preserve dirty state; edits made during a save
remain unsaved until the next save. There is no local Save-button fallback for older hosts.
Use the matching workspace host and publish SDK 0.2 before deploying this application.

See `smart-editor.app.yaml` for the application registration manifest.

## Manifest environments & publishing

The app manifest uses a shared base plus environment overlays:

- `smart-editor.app.yaml` keeps shared metadata, entry points, MIME types, sandbox, OAuth client type, scopes, and packaging.
- `environments/local.yaml` sets `spec.entry` and `spec.oauth.redirect-uris` to `https://smart-editor.apps.localtest.me` through Aspire's shared HTTPS gateway.
- `environments/feature.yaml` sets them to `https://${param:app-host}`, the pull request preview host supplied at publish time.
- `environments/production.yaml` sets them to the region-free `https://smart-editor.apps.verentis.io`.

The Verentis CLI deep-merges the selected overlay onto the base manifest; objects merge, while arrays and scalars from the overlay replace the base. The base does not define `spec.entry` or `spec.oauth.redirect-uris`, and only those fields should differ per environment. Use `--overlay <path>` instead of `--env` only when selecting an explicit overlay file. Validate the merged manifest with:

```bash
verentis validate . --env local
verentis validate . --env feature --param app-host=smart-editor-pr-1.apps.feature.verentis.dev
verentis validate . --env production
```

Pack the app for a specific environment with:

```bash
verentis pack . --env local
verentis pack . --env production --set-version <version>
```

The repository's `pull-request.yml` and `release.yml` workflows publish the package with the `feature` overlay for previews and the feature registry, and with the `production` overlay for the global production registry, using version `<major.minor>.<commits on main>` (pull requests add a `-pr.<n>` prerelease). See [DEPLOYMENT.md](DEPLOYMENT.md).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start dev server (port 3302) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run tests |

## License

UNLICENSED — proprietary software.
