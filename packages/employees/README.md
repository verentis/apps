# Employees

Departments and employees stored as JSON files in your workspace. Opening an Employees record renders its
Canvas form. Employees folders open in the file browser, where **New** offers the records that belong
there (for example **Employee** inside `/employees`). Employees move through an employment status;
terminating is a scripted action that enforces the transition. Employees does not use the platform
business store or business commands.

## Workspace layout

Employees names records by a generated code, without a file extension:

```text
/departments                              application/vnd.verentis.employees.departments (seeded)
  DEP-0001                                application/vnd.verentis.employees.department+json (starter department, seeded)
/employees                                application/vnd.verentis.employees.employees (seeded)
  EMP-0001 …                              application/vnd.verentis.employees.employee+json (sample employees, seeded)
/settings/employees.json                  application/vnd.verentis.employees.settings+json (seeded)
/applications/employees/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) — together with a starter department and
sample employees — and uninstall keeps them. No Canvas document is bound to the container types, so they
open in the file browser. Inside a plain folder named like a container (for example `employees` or `hr`),
New still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `department` | `department-code-prefix` (`DEP-`) | Name and a manager reference to an employee |
| `employee` | `employee-code-prefix` (`EMP-`) | Name, job title, department and manager references, work email/phone, start date, `status`, `terminationDate` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

## Employment lifecycle

Statuses: `active | on-leave | terminated`. The form edits `active` and `on-leave` freely; the schema
requires `terminationDate` and `terminatedAt` once terminated, so that status is reached only through the
action script:

- **Terminate** (`active` → `terminated`): stamps the termination date (a form field, defaulting to
  today), checks it is not before the start date, and locks the form.

The action is idempotent — re-running it returns a friendly message instead of failing — and updates the
employee conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten. Invalid
transitions (terminating an on-leave or archived employee) fail with a clear error.

## Creation

The create script names the new record (next code), defaults an employee's department from the Employees
settings (`defaultDepartment`) and the start date to today. Records are written create-only
(`If-None-Match: *`); a taken name moves on to the next code.

## Pages

- **Employees** (home): active/on-leave/terminated/department counts and file browsers over the containers.
- **Directory**: every employee with department, manager and status, sorted by name; terminated hidden by default.
- **Departments**: headcount per department (active, on leave, terminated) with the department manager.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written. `vitest run` validates the contracts, pages and
scripts.
