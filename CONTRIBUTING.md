# Contributing

Keep applications independently buildable and publishable under `packages/<name>/`. Changes shared by all
applications belong at the repository root; application behavior, manifests, assets, and changelogs belong
to the owning package.

Before opening a pull request:

```bash
npm install
npm run test
npm run build
```

Validate changed package roots with the Verentis CLI for every supported environment overlay. Do not change
marketplace package IDs as part of repository maintenance.
