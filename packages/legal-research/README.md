# Legal Research

The shared Canvas reader searches installed bibliographic packs in `/legal-authority-packs`. It ships no jurisdiction index. Each pack installs one managed file with MIME `application/vnd.verentis.legal-research.pack+json`; the reader lists those files using read access only. Only trusted reference-data installers should have write access to this folder.

When upgrading from the bundled South African index, install **South Africa Law** to continue searching those citations. The reader does not consult the old managed catalogue, even if an upgraded workspace retains it. Existing frozen agreement citations do not need conversion.

Run `npm run build`, `npm run check` and `npm run test:run` after changing the reader. The South African source revision, coverage and maintainer refresh procedure are documented in `packages/south-africa-law/README.md`.
