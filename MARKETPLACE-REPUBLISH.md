# Marketplace republish

To republish every package (for example after renewing the publisher trust or signing key), run the `Release`
workflow on `main` with **everything** checked. Each package is published as a new patch version to the feature
registry and then the global production registry; hosted apps are rebuilt once and rolled out again.
