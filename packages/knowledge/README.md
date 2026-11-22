# Knowledge

Spaces and articles, stored as JSON files in your workspace. An article's body is a **Markdown string**
(the platform's `text/markdown` building block, as the Markdown Viewer renders it) — Knowledge does not
invent its own rich-text format. Opening a Knowledge record renders its Canvas form. Knowledge folders
open in the file browser, where **New** offers the records that belong there (for example **Article**
inside `/articles`). Knowledge does not use the platform business store or business commands.

## Workspace layout

```text
/knowledge-spaces                         application/vnd.verentis.knowledge.spaces (seeded)
  KS-0001                                 application/vnd.verentis.knowledge.space+json
/articles                                 application/vnd.verentis.knowledge.articles (seeded)
  KA-0001                                 application/vnd.verentis.knowledge.article+json
  KA-0002                                 …article+json, parent: /articles/KA-0001 (nested)
/settings/knowledge.json                  application/vnd.verentis.knowledge.settings+json (seeded)
/applications/knowledge/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) along with a starter space, three starter
articles (one nested beneath another) and the settings; uninstall keeps them all. No Canvas document is
bound to the container types, so they open in the file browser. Inside a plain folder named like a
container (for example `articles` or `knowledge`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `space` | `space-code-prefix` (`KS-`) | Name, description and a short icon note |
| `article` | `article-code-prefix` (`KA-`) | Title, space and optional parent article references (paths), Markdown `body`, `tags[]`, `status`, `owner`; `publishedAt` is required when published |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived; archiving a record only sets `state`). Unknown fields are rejected.

An article refers to its space and its optional parent article by absolute workspace path
(`/knowledge-spaces/KS-0001`, `/articles/KA-0001`); the parent reference forms the article hierarchy the
Spaces page shows. Moving or renaming a record breaks path references.

### Article lifecycle

`status` is `draft`, `published` or `archived`, and only the action script moves it:

- **publish** — `draft → published`. The title and the Markdown body must be filled in; `publishedAt`
  and `updatedAt` are stamped.
- **archive** — `published → archived`. Archived articles lock their form until restored.
- **restore** — `archived → draft`, so the article can be edited and published again.

Every transition is idempotent (re-running a finished operation returns a friendly message without a
write) and conditional: the article is written back with `If-Match`, so a concurrent edit fails with a
conflict instead of being overwritten. Invalid transitions (publishing an archived article, archiving a
draft, restoring a published article) fail with a clear error.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. When you pick
**New → Article**, the workspace runs `scripts/create` (Node.js, server) with the template, the parent
path and the parent's child names. Inside `/articles` and `/knowledge-spaces` the script creates the
record itself, create-only (`If-None-Match: *`), and returns its `{ path }`; the workspace opens it.
Elsewhere it returns a `{ name, content }` proposal that the workspace writes with your own token.

- Records get the next code after the highest existing sibling with the same prefix (`KA-0042`). A code
  taken in the meantime moves on to the next one (up to five attempts). Prefixes and digits come from the
  Knowledge app settings.
- New articles start as drafts in the default space from `/settings/knowledge.json` (`defaultSpace`).

`scripts/create/main.mjs` and `propose.mjs` are copied from the shared `tools/file-apps` sources by the
build; `scripts/create/config.mjs` is generated from the contracts.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Article and space counts; a browser tab per container |
| `spaces.page.yaml` | none | Space browser: spaces with counts, and every article grouped by space with nested articles indented beneath their parent |
| `recent.page.yaml` | none | The 50 most recently updated active articles |
| `tags.page.yaml` | none | Tag filter summary: every tag with its article counts by status |
| `article.form.yaml`, `space.form.yaml` | edit | Bound record forms; the article form carries the Publish, Archive and Restore actions |
| `settings.form.yaml` | edit | Edits `/settings/knowledge.json` |

- Forms load the file through a `kind: document` source with `consistency: conditional` and save with `save`.
- The article body is edited as a multiline Markdown textarea; the schema marks it
  `contentMediaType: text/markdown`.
- The status select is read-only: transitions run the action script, which reloads the form and toasts the
  script's message.
- Record forms declare `spec.access` read grants for the containers they offer in selects and for
  `/applications/knowledge/`; unbound pages declare the containers they list.

The build writes each bound document's registration fields (`entry`, `scope`, `mime-types`, `permissions`,
`capabilities`, `file-access`, `sandbox`) following the Canvas designer projection. The `canvas-origin`
packaging variable is substituted at pack time.

## Build and test

```bash
npm --workspace @verentis/app-knowledge run build      # node src/build.mjs
npm --workspace @verentis/app-knowledge run check      # fails when generated outputs are stale
npm --workspace @verentis/app-knowledge run test:run
```

`src/build.mjs` generates `knowledge.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*`, the create script and the script manifests from `src/app.mjs`,
`src/contracts.mjs` and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written and unit tested against
an in-memory files client with real ETag semantics.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and article action scripts.

## Known gaps

- Canvas has no Markdown form control, so the body is edited as a plain textarea; it renders as Markdown
  wherever the workspace shows `text/markdown` content.
- Canvas folder sources list direct children only, so the hierarchy is a flat list with parent references,
  indented one level on the Spaces page (deeper nesting still works, but shows under the first parent level).
- Canvas exposes no current-user identity, so `owner` is entered by hand.
- Creating a record runs a server script, which can take a few seconds.
