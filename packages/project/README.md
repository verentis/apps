# Project

Projects and their tasks, stored as JSON files in your workspace. Opening a Project record renders its
Canvas form. Project folders open in the file browser, where **New** offers the records that belong
there (**Project** inside `/projects`, **Task** inside `/tasks`). Tasks move through a stage board and
are marked done by a script that validates the stage transition.

## Workspace layout

Records are named by a generated code, without a file extension. The MIME type, not an extension, says
what a node is.

```text
/projects                                 application/vnd.verentis.project.projects (seeded)
  PROJ-0001                               application/vnd.verentis.project.project+json
/tasks                                    application/vnd.verentis.project.tasks (seeded)
  TASK-0001                               application/vnd.verentis.project.task+json
/settings/project.json                    application/vnd.verentis.project.settings+json (seeded)
/applications/project/{canvas,schemas,templates,scripts}/   managed package assets
```

The containers are content-less typed nodes. Install seeds them once (`mode: seed`) and uninstall keeps
them. No Canvas document is bound to the container types, so they open in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `project` | `project-code-prefix` (`PROJ-`) | Name, optional CRM customer reference, status `active | on-hold | done`, description |
| `task` | `task-code-prefix` (`TASK-`) | Project reference, title, stage `backlog | in-progress | review | done`, priority `low | medium | high | urgent`, assignee, due date, description; `completedAt` is required when done |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Unknown fields are rejected. A task references its project by absolute workspace path
(`/projects/PROJ-0001`); a project optionally references a CRM customer the same way.

`src/contracts.mjs` defines the schemas; `schemas/*.schema.json` are the generated JSON Schema 2020-12
documents. The schema IDs are identifiers, not hosted endpoints.

## Creating records: the create script

Every creatable uses `script: ./scripts/create` with the packaged `templates/<kind>.json`. Inside
`/projects` and `/tasks` the script creates the record itself, create-only, and returns its `{ path }`;
a taken code moves on to the next one (up to five attempts). Elsewhere it returns a `{ name, content }`
proposal the workspace writes with your own token. Prefixes and digits come from the app settings; a new
task's empty `assignee` is filled from `/settings/project.json`.

## Completing tasks: the task script

The task form's **Complete** button runs `scripts/post` (`project-post`) with
`operation: complete-task`. The script validates the stage transition (`backlog`, `in-progress` or
`review` → `done`; anything else fails), requires a title, stamps `completedAt`, and saves the task
conditionally (If-Match), so a concurrent edit conflicts instead of being overwritten. Completing an
already-done task returns a friendly message instead of failing. Done tasks are locked in their form.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Project and task counts; a browser tab per container |
| `board.page.yaml` | entry point | Tasks grouped by stage with per-stage counts |
| `project.form.yaml` | edit | Project form with a per-project task summary tab (counts by stage and a task table) |
| `task.form.yaml` | edit | Task form with the **Complete** action |
| `settings.form.yaml` | none | Edits `/settings/project.json` |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. The project form offers CRM customers (optional dependency `verentis/crm`) through a folder
source on `/customers`; without CRM the source simply stays empty. The build writes each bound
document's registration fields following the Canvas designer projection; the `canvas-origin` packaging
variable is substituted at pack time.

## Build and test

```bash
npm --workspace @verentis/app-project run build      # node src/build.mjs
npm --workspace @verentis/app-project run check      # fails when generated outputs are stale
npm --workspace @verentis/app-project run test:run
```

`src/build.mjs` generates `project.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written and unit tested with an in-memory files
client, including invalid transitions and concurrent edits.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and task scripts.
- Optionally `verentis/crm` for customer references.
