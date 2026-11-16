# Verentis Markdown Viewer

Installer-facing listing: [Marketplace README](marketplace/README.md). Development documentation continues below.

A Nuxt 4 application that renders Markdown files inside the Verentis workspace iframe.
It opens a `.md` file from the workspace and displays it with GitHub-flavored formatting.

## Features

- **GitHub-flavored Markdown** — tables, task lists, strikethrough, and autolinks via `markdown-it`.
- **Syntax highlighting** for fenced code blocks (`highlight.js`), themed for light and dark mode.
- **Safe rendering** — all generated HTML is sanitised with DOMPurify before it touches the DOM.
- **Outline / table of contents** generated from headings, with scroll-spy and click-to-jump.
- **Preview ⇄ Source** toggle, plus copy-to-clipboard for the document and for individual code blocks.
- **Relative assets** — relative image `src`s are fetched through the SDK, and relative links navigate the workspace via the host bridge.
- **Theme aware** — follows the host workspace colour scheme (and the system preference in standalone mode).

## Prerequisites

Copy source is registered through SDK 0.2 and rendered exclusively in the workspace header,
including fullscreen entries. The host performs the clipboard write from the user gesture and
reports browser permission failures. Preview/Source, outline, and code-block copy controls remain
inside the viewer. Deploy with the matching host after releasing SDK 0.2; no local document-copy
fallback is provided for older hosts.

- Node.js 22+

## Setup

### 1. Install dependencies

```bash
npm install
```

### 3. Start development

```bash
cp .env.example .env   # only needed for standalone dev outside the workspace
npm run dev
```

The dev server starts at [http://localhost:3303](http://localhost:3303).

## How It Works

The `useVerentis()` composable auto-detects the environment:

- **iframe mode** — hosted by the workspace; context (workspace, file, token) arrives over PostMessage.
- **Standalone mode** — running independently; authenticates with the API key from `.env`.

The opened file is read with `client.files.readContent(path)`, decoded as text, and passed to
`useMarkdown().render()`, which returns sanitisable HTML plus a table of contents. The
`MarkdownDocument` component injects the sanitised HTML and wires up code-copy buttons,
external links, relative images, and in-page anchors.

## Project Structure

```
app/
  app.vue                          — Root component
  composables/useVerentis.ts       — SDK initialisation & context
  composables/useMarkdown.ts       — markdown-it setup, render() -> { html, toc }
  components/MarkdownDocument.client.vue — Sanitises & enhances rendered HTML
  pages/index.vue                  — Toolbar, outline, preview/source, states
  assets/css/tailwind.css          — Tailwind + shadcn theme
  assets/css/markdown.css          — Markdown typography + highlight.js theme
  lib/utils.ts                     — cn() utility
nuxt.config.ts                     — Nuxt configuration (port 3303)
markdown-viewer.app.yaml           — Verentis application manifest
```

## App Manifest

`markdown-viewer.app.yaml` registers the app with a workspace. It binds the `text/markdown`
and `text/x-markdown` MIME types in `view` mode and requests the `file.read` permission.

## Manifest environments & publishing

The app manifest uses a shared base plus environment overlays:

- `markdown-viewer.app.yaml` keeps shared metadata, entry points, MIME types, sandbox, OAuth client type, scopes, and packaging.
- `environments/local.yaml` sets `spec.entry` and `spec.oauth.redirect-uris` to `https://markdown-viewer.apps.localtest.me` through Aspire's shared HTTPS gateway.
- `environments/feature.yaml` sets them to `https://${param:app-host}`, the pull request preview host supplied at publish time.
- `environments/production.yaml` sets them to the region-free `https://markdown-viewer.apps.verentis.io`.

The Verentis CLI deep-merges the selected overlay onto the base manifest; objects merge, while arrays and scalars from the overlay replace the base. The base does not define `spec.entry` or `spec.oauth.redirect-uris`, and only those fields should differ per environment. Use `--overlay <path>` instead of `--env` only when selecting an explicit overlay file. Validate the merged manifest with:

```bash
verentis validate . --env local
verentis validate . --env feature --param app-host=markdown-viewer-pr-1.apps.feature.verentis.dev
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
| `npm run dev` | Start dev server (port 3303) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run generate` | Generate static site |
| `npm test` | Run tests |

## CI / GitHub Actions

No npm registry credentials are required; `@verentis/sdk` is public on npmjs.

## License

UNLICENSED — proprietary software.
