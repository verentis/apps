# Field Service

Field tasks as files in your workspace: schedule technicians, log hours and materials on site, and draft
invoices for completed work. The Verentis Field Service equivalent of Odoo Field Service.

## How it works

Every field task is one JSON file in the seeded `/field-tasks` container, typed by the vendor MIME
`application/vnd.verentis.field-service.task+json` and validated against the installed JSON Schema. Tasks are
created from the platform **New** menu by the create script, which numbers them (`FST-0001`, prefix and width
are app settings) and fills the default technician from `/settings/field-service.json`.

### Workspace layout

| Path | Contents |
| --- | --- |
| `/field-tasks` | Field task records, one JSON file per task, named by their code (seeded container) |
| `/settings/field-service.json` | Defaults new tasks start with (seeded) |
| `/applications/field-service` | The installed app: Canvas documents, schemas, templates, scripts (managed) |

Seeds live outside the install root on purpose: uninstalling removes the app but keeps your tasks.

### Task flow

A task moves `new → scheduled → on-site → done`; any open stage can be `cancelled`. The stage is changed only
by the action script the task form runs:

- **Schedule** requires a scheduled date and a technician.
- **Start** marks the technician on site.
- **Complete** requires positive hours, computes the materials total exactly (BigInt minor units, never
  floats), stamps `completedAt` and locks the task. When the Invoicing app is installed (its `/invoices`
  container exists), it also drafts an invoice under the task's own code — create-only, so a retried
  completion never drafts twice.
- **Cancel** stamps `cancelledAt` and locks the task.

All updates are conditional (`If-Match`), so a concurrent edit conflicts instead of being overwritten, and
re-running a finished operation returns a friendly message instead of failing.

### Optional dependencies

- **CRM** — the task form offers CRM customers from `/customers` and can copy the chosen customer's name. The
  select simply stays empty when CRM is not installed.
- **Invoicing** — completed tasks draft an invoice (labour line plus materials) in Invoicing's vendor MIME.
  Without Invoicing the task completes without a draft.

### Pages

- **Field Service** — overview with counts and the task list.
- **Tasks** — every active task, grouped by stage.
- **Day schedule** — today's open tasks per technician, ordered by time window.

## Development

```bash
node src/build.mjs            # regenerate manifest, Canvas documents, schemas, templates, seeds and scripts
node src/build.mjs --check    # fail if any generated output is stale
npm run test:run              # vitest: contracts, pages, create and action-script tests
```

Hand-authored sources are `src/contracts.mjs`, `src/app.mjs`, `src/pages.mjs`, `src/build.mjs` and
`scripts/post/main.mjs`; everything else under `canvas/`, `schemas/`, `templates/`, `seed/` and `scripts/` is
generated.
