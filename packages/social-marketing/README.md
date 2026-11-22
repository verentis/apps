# Social Marketing

Social accounts and posts as plain files in your workspace. Each record is one JSON file in a typed container
(`/social-accounts`, `/social-posts`), edited through bound Canvas forms and summarised by unbound pages.

## What it does

- **Social accounts** (`SOA-…`): a network (Mastodon, LinkedIn, X, Facebook or other), a handle and an active
  switch. Only active accounts can publish posts.
- **Posts** (`SOP-…`): an account reference, content, an optional media note, a scheduled date and a status
  (`draft → scheduled → published`, or `draft/scheduled → cancelled`). Publishing stamps `publishedAt` and locks
  the account, schedule and content; the engagement counts (likes, shares, comments) stay editable afterwards so
  they can be recorded by hand.
- **Pages**: a launch overview, an upcoming-posts calendar list (scheduled posts, earliest first) and an
  engagement page that sums published posts, likes, shares and comments per account.

Schedule, Publish and Cancel are script actions (`scripts/post`) that enforce the status transitions, check the
social account is active at publish, update posts conditionally (If-Match) and are safe to re-run. New records are
named with generated codes by the shared create script (`scripts/create`).

## Delivery-integration boundary

This is a file-based app: **it never talks to a social network's API**. "Publishing" a post is a stage transition
that validates the record, stamps `publishedAt` and locks the content — actual delivery (posting through
Mastodon/LinkedIn/X/Facebook APIs) and engagement retrieval are platform integration concerns to be wired up by a
platform service that watches these records. Engagement is therefore recorded manually on published posts.

## Development

```sh
node src/build.mjs          # regenerate manifest, canvas documents, schemas, templates, seeds, script manifests
node src/build.mjs --check  # fail if any committed output is stale
npx vitest run              # contracts, pages and action-script tests
```

Hand-authored sources live in `src/` (`contracts.mjs`, `app.mjs`, `pages.mjs`) and `scripts/post/main.mjs`;
everything else is generated.
