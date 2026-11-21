# Timesheets

Timesheet entries, stored as JSON files in your workspace. Opening an entry renders its Canvas form.
The `/timesheets` folder opens in the file browser, where **New** offers **Timesheet entry**. Entries
optionally reference projects and tasks from the **Project** app and are validated by a script that
checks the hours and locks the entry.

## Workspace layout

Records are named by a generated code, without a file extension. The MIME type, not an extension, says
what a node is.

```text
/timesheets                               application/vnd.verentis.timesheets.entries (seeded)
  TS-0001                                 application/vnd.verentis.timesheets.entry+json
/settings/timesheets.json                 application/vnd.verentis.timesheets.settings+json (seeded)
/applications/timesheets/{canvas,schemas,templates,scripts}/   managed package assets
```

The container is a content-less typed node. Install seeds it once (`mode: seed`) and uninstall keeps
it. No Canvas document is bound to the container type, so it opens in the file browser.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `entry` | `entry-code-prefix` (`TS-`) | Employee name, date, optional project and task references, hours, description, status `draft | validated`; `validatedAt` is required when validated |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`,
a UUID `id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` required when
archived). Unknown fields are rejected. **Hours are an exact decimal string** (`"7.5"`), never a JSON
number; the schema rejects numbers and pages sum hours as integer ten-thousandths.

`src/contracts.mjs` defines the schemas; `schemas/*.schema.json` are the generated JSON Schema 2020-12
documents. The schema IDs are identifiers, not hosted endpoints.

### Project references (optional dependency)

Timesheets declares `verentis/project` as an **optional** dependency. It never imports the Project app;
it reads Project's public file contract: entries reference `/projects/PROJ-0001` and `/tasks/TASK-0001`
by absolute workspace path, and the entry form offers them through folder sources on `/projects` and
`/tasks`. Without the Project app those selects simply stay empty, and the weekly summary groups the
hours under the raw path (or "(no project)").

## Creating records: the create script

The creatable uses `script: ./scripts/create` with the packaged `templates/entry.json`. Inside
`/timesheets` the script creates the entry itself, create-only, and returns its `{ path }`; a taken
code moves on to the next one (up to five attempts). Elsewhere it returns a `{ name, content }`
proposal the workspace writes with your own token. The code prefix and digits come from the app
settings; a new entry's `date` defaults to today and its empty `employee` is filled from
`/settings/timesheets.json`.

## Validating entries: the validation script

The entry form's **Validate** button runs `scripts/post` (`timesheets-post`) with
`operation: validate-entry`. The script requires a draft with an employee name, a date and hours that
are a **positive** decimal string (zero, negative, malformed or numeric hours fail), then stamps
`validatedAt`, marks the entry `validated` and saves it conditionally (If-Match), so a concurrent edit
conflicts instead of being overwritten. Validating an already-validated entry returns a friendly
message instead of failing. Validated entries are locked in their form.

## Canvas documents (`canvas/`)

| Document | Binding | Purpose |
| --- | --- | --- |
| `home.page.yaml` | launch entry point | Entry counts, draft/validated hours and the entries list |
| `week.page.yaml` | entry point | Hours by project over the last seven days (today inclusive), draft vs validated |
| `entry.form.yaml` | edit | Entry form with project/task selects and the **Validate** action |
| `settings.form.yaml` | none | Edits `/settings/timesheets.json` |

Forms load the file through a `kind: document` source with `consistency: conditional` and save with
`save`. The build writes each bound document's registration fields following the Canvas designer
projection; the `canvas-origin` packaging variable is substituted at pack time.

## Build and test

```bash
npm --workspace @verentis/app-timesheets run build      # node src/build.mjs
npm --workspace @verentis/app-timesheets run check      # fails when generated outputs are stale
npm --workspace @verentis/app-timesheets run test:run
```

`src/build.mjs` generates `timesheets.app.yaml`, `environments/*.yaml`, `canvas/*`, `schemas/*`,
`templates/*`, `seed/*` and the generated parts of `scripts/` from `src/app.mjs`, `src/contracts.mjs`
and `src/pages.mjs`. `scripts/post/main.mjs` is hand-written and unit tested with an in-memory files
client, including invalid hours, invalid transitions and concurrent edits; the cross-app tests seed
Project records from `@verentis/app-project`'s contracts.

## Requirements

- The Canvas build with the `canvas.files` component and `spec.access` support.
- The `verentis/nodejs` engine for the create and validation scripts.
- Optionally `verentis/project` for project and task references.
