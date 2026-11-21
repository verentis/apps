# Discuss

Team discussion channels and threaded messages stored as JSON files in your workspace. Opening a Discuss
record renders its Canvas form. Discuss folders open in the file browser, where **New** offers the records
that belong there (for example **Thread** inside `/threads`). Posting a message and the thread/channel
lifecycle are scripted actions that enforce the transitions. Discuss does not use the platform business
store or business commands.

## Not a realtime chat transport

Discuss is **file-based by design**: it is the durable, auditable discussion record — who said what, when,
in which channel — kept as plain JSON files you can read, back up, diff and audit. It deliberately contains
**no realtime messaging transport**: no websockets, no polling infrastructure, no presence and no push.
Realtime delivery, live updates and notifications are a **platform concern**; when the platform notifies
clients of file changes, Discuss views refresh like any other file-based app. What this app guarantees is
the record itself: messages are appended by script, never silently rewritten, and every change is
conditional so concurrent edits conflict instead of being lost.

## Workspace layout

Discuss names records by a generated code, without a file extension:

```text
/channels                                 application/vnd.verentis.discuss.channels (seeded)
  CH-0001                                 application/vnd.verentis.discuss.channel+json (General channel, seeded)
/threads                                  application/vnd.verentis.discuss.threads (seeded)
  TH-0001                                 application/vnd.verentis.discuss.thread+json (welcome thread, seeded)
/settings/discuss.json                    application/vnd.verentis.discuss.settings+json (seeded)
/applications/discuss/{canvas,schemas,templates,scripts}/   managed package assets
```

The record's content is JSON. The MIME type, not an extension, says what the node is. The containers are
content-less typed nodes. Install seeds them once (`mode: seed`) — together with a **General** channel and a
welcome thread — and uninstall keeps them. No Canvas document is bound to the container types, so they open
in the file browser. Inside a plain folder named like a container (for example `threads` or `discuss`), New
still offers its records.

## Records

| Kind | Code setting (default) | Notes |
| --- | --- | --- |
| `channel` | `channel-code-prefix` (`CH-`) | Name, topic, kind (stored as `visibility: public \| private` — the envelope owns `kind`), members, `status: active \| archived`, createdBy |
| `thread` | `thread-code-prefix` (`TH-`) | Channel reference, subject, startedBy, `status: open \| resolved \| locked`, the message trail, `lastActivityAt` |

`code-digits` (default 4) pads the number. Every record has `$schema`, `schemaVersion: 1`, `kind`, a UUID
`id`, UTC `createdAt`/`updatedAt`, and `state: active | archived` (`archivedAt` when archived).

A thread's `messages` is the ordered trail: `{ sequence, author, date, body, edited }`, with the body in
Markdown. Messages are appended by the **Post message** action, which composes from the thread's `draft`
and `postAs` fields and clears the draft after posting.

## Lifecycle

Thread statuses: `open → resolved → locked`, with `resolved → open` through Reopen. The schema requires
`resolvedAt` once resolved and `lockedAt` once locked, so those statuses are reached only through the
action script:

- **Post message** (`open` only): appends `{ sequence: next, author, date, body }` to the trail, stamps
  `lastActivityAt`, and clears the draft. It rejects an empty body, resolved/locked threads and threads
  whose channel is archived. The action passes an **idempotency key** that is stored on the message: a
  retried run finds its key already in the trail and does not append twice.
- **Resolve** (`open` → `resolved`): stamps `resolvedAt`.
- **Lock** (`resolved` → `locked`): stamps `lockedAt`; the form locks a locked thread.
- **Reopen** (`resolved` → `open`): clears `resolvedAt`; locked threads stay locked.
- **Archive channel** (`active` → `archived`): archived channels reject new messages in their threads.

All actions are idempotent — re-running a finished one returns a friendly message instead of failing — and
update the record conditionally (`If-Match`), so a concurrent edit conflicts instead of being overwritten.
Invalid transitions (resolving a locked thread, locking an open one, reopening a locked one) fail with a
clear error.

## Pages

- **Discuss** (home): open/resolved/locked thread and message counts, and file browsers over the containers.
- **Channels**: every active channel with its kind, members, open threads and last activity.
- **Threads**: every active thread by last activity, grouped by status. Opening a thread shows its message
  trail and the compose section.

## Development

`src/contracts.mjs`, `src/app.mjs` and `src/pages.mjs` are the sources; `node src/build.mjs` generates the
manifest, Canvas documents, schemas, templates, seeds and the generated script parts (`--check` verifies
they are fresh). `scripts/post/main.mjs` is hand-written; the create script is copied from the shared
tooling at build time. `vitest run` validates the contracts, pages and scripts.
