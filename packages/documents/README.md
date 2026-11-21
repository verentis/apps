# Documents

A tagging and review workflow over files that already live in your workspace. Document **cards** are small
JSON metadata records that *reference* a VFS path (`filePath`), are filed into **workspaces**, labelled with
**tags**, and moved through an inbox → review → validated → archived workflow by scripted actions. Opening a
Documents record renders its Canvas form. Documents folders open in the file browser, where **New** offers
the records that belong there (for example **Document** inside `/document-cards`). Documents does not use
the platform business store or business commands.

## The VFS stores the files — Documents never does

**This app does not store, copy, upload, version or move file content.** The Verentis platform VFS already
stores and versions every file natively. Documents is deliberately a *thin metadata layer on top of it*:

- A document card's `filePath` is a plain workspace path reference (for example
  `/shared/legal/globex-msa.pdf`). The file stays exactly where it is, owned and versioned by the VFS.
- No Canvas page or form declares a data source over the referenced file, and no script ever reads or
  writes it — the workflow script's only write grant is the `/document-cards` container.
- Deleting or archiving a card never touches the referenced file; deleting the file never touches the card
  (the card simply points at a path that no longer exists until you update it).
- There is no duplicate "document storage": the only things Documents writes are its own metadata records.

## Workspace layout

Documents names records by a generated code, without a file extension:

```text
/document-workspaces                      application/vnd.verentis.documents.workspaces (seeded)
  DWS-0001 …                              application/vnd.verentis.documents.workspace+json (2 starter workspaces, seeded)
/document-cards                           application/vnd.verentis.documents.cards (seeded)
  DOC-0001 …                              application/vnd.verentis.documents.document+json (sample cards, seeded)
/document-tags                            application/vnd.verentis.documents.tags (seeded)
  DTG-0001 …                              application/vnd.verentis.documents.tag+json (starter tag set, seeded)
/settings/documents.json                  application/vnd.verentis.documents.settings+json (seeded)
/applications/documents/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) — together with two starter workspaces, a
tag set and sample document cards — and uninstall keeps them. No Canvas document is bound to the container
types, so they open in the file browser. Inside a plain folder named like a container (for example
`document-cards` or `documents`), New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `workspace` | `workspace-code-prefix` (`DWS-`) | Name, description, `defaultTags` — new cards filed here start with these tags |
| `document` | `document-code-prefix` (`DOC-`) | Title, `filePath` (VFS path reference), workspace reference, `tags`, owner, workflow `status`, notes, `reviewComment`, `validatedAt` |
| `tag` | `tag-code-prefix` (`DTG-`) | Label and category — the curated tag vocabulary |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived). The workflow
status `archived-status` is distinct from the record state `archived`.

## Document workflow

Statuses: `inbox → in-review → validated → archived-status`, with `in-review → inbox` as the return path.
The form edits inbox and in-review cards freely; the transitions run through the action script
(`scripts/post`), which enforces them:

| Action | Transition | Effect |
| --- | --- | --- |
| **Send to review** | `inbox → in-review` | Hands the card to a reviewer |
| **Validate** | `in-review → validated` | Stamps `validatedAt`; the form locks |
| **Archive** | `validated → archived-status` | Retires the card, keeping its validation stamp; stays locked |
| **Return to inbox** | `in-review → inbox` | Requires a review comment (the form's `reviewComment` or a `comment` parameter) |

Any other transition fails with a clear message. Re-running a finished operation returns a friendly
"already …" message instead of failing, so retries are safe. Updates are conditional (`If-Match` on the ETag
the card was read at): a concurrent edit fails with a conflict instead of being overwritten. The schema backs
the workflow up: `validated` and `archived-status` cards must carry `validatedAt`.

## Creating records

The create script (`scripts/create`) names new records with the next code, writes them **create-only**
(`If-None-Match: *`) into their container, defaults a new card's workspace from
`/settings/documents.json` (`defaultWorkspace`) and fills its empty `tags` from that workspace's
`defaultTags`. A missing or unreadable workspace leaves the tags empty; the card is still created. Outside
its granted containers the script returns a `{ name, content }` proposal the workspace writes with the
user's token.

## Pages

| Entry point | Document | Shows |
| --- | --- | --- |
| Documents | `canvas/home.page.yaml` | Status counts and browsers over cards, workspaces and tags |
| Inbox | `canvas/inbox.page.yaml` | Cards waiting to be filed and sent to review |
| Workspaces | `canvas/workspaces.page.yaml` | Per-workspace browser: counts per workspace, tag groups, and cards grouped by workspace and tags |
| Library | `canvas/library.page.yaml` | Validated and archived cards with their validation stamps |

The document form shows the `filePath` reference with an **Open file** link that opens the referenced file
in the workspace — the card itself stays pure metadata.

## Development

Everything under `canvas/`, `schemas/`, `templates/`, `seed/`, `environments/`, the app manifest and the
generated script parts is produced by `node src/build.mjs` from `src/contracts.mjs`, `src/app.mjs` and
`src/pages.mjs`; `node src/build.mjs --check` fails when they are stale. `npm run test:run` runs the vitest
suite (contracts, pages, create and workflow transitions against an in-memory files client).
