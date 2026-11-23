# South Africa Law

This add-on installs a managed bibliographic index at `/legal-authority-packs/ZA`. Its launch page preselects South Africa in the shared Legal Research reader. Authority IDs, revisions, and source URLs are unchanged from the formerly bundled index. No statutory wording is bundled.

`src/catalog.mjs` records the specific upstream paths and dated changes verified against the [Lexifina ZA corpus](https://github.com/lexifina/south-africa-law/tree/4ebf763ffbf5b065e6a87217eae44915eb0a243b). Snapshot `from` dates refer to provision changes, not Act-wide publication dates. The final date is bounded by the reviewed corpus revision; never extrapolate beyond it. Compare links are evidence, not legal advice. See the upstream [licence and source distinctions](https://github.com/lexifina/south-africa-law/blob/4ebf763ffbf5b065e6a87217eae44915eb0a243b/LICENSE).

Additions require checking source licences, the exact path and commit, commencement and missing historical periods. Run `npm run build` and `npm run check` in this package after changing records.

`node src/index-instruments.mjs` refreshes the instrument directory from three metadata files at the SHA in `src/revision.mjs`. It does not download provision wording. Generate only during a deliberate source review; normal package builds and workspace searches are offline. Dated comparisons are available only for the separately curated provision histories.
