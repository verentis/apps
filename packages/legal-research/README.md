# Legal Research

The Canvas page reads a bundled South African citation file and jurisdiction packs installed into `/legal-authority-packs`. It requires read access only. Contract Studio can retain the authority ID, citation, URL and revision without copying the law. No text, judgments, annotations, external search API or model is bundled.

`src/catalog.mjs` records the specific upstream paths and dated changes verified against the [Lexifina ZA corpus](https://github.com/lexifina/south-africa-law/tree/4ebf763ffbf5b065e6a87217eae44915eb0a243b). Snapshot `from` dates refer to provision changes, not Act-wide publication dates. The final date is bounded by the reviewed corpus revision; never extrapolate beyond it. Compare links are evidence, not legal advice. See the upstream [licence and source distinctions](https://github.com/lexifina/south-africa-law/blob/4ebf763ffbf5b065e6a87217eae44915eb0a243b/LICENSE).

Only administrators entrusted with installing reference data should have write access to the pack registry. Do not put private case notes there. Additions require checking source licences, the exact path and commit, commencement and missing historical periods. Run `npm run build`, `npm run check` and `npm run test:run` in this package after changing records.

`node src/index-instruments.mjs` refreshes the instrument directory from three metadata files at the SHA in `src/revision.mjs`. It does not download provision wording. Generate only during a deliberate source review; normal package builds and workspace searches are offline. Dated comparisons are available only for the separately curated provision histories.
