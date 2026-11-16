# Deployment

The Smart Editor app is a hosted app of this repository, declared in
[`.github/verentis-delivery.json`](../../.github/verentis-delivery.json) and shipped by the repository's
`pull-request.yml` and `release.yml` workflows (shared contract: `verentis/.github` `docs/app-delivery.md`).

| Event | Result |
|---|---|
| Pull request | Preview at `https://smart-editor-pr-<n>.<feature apps domain>`, removed when the pull request closes |
| Merge to `main` | One image (`verentis/smart-editor@sha256:…`) rolled out to `feature`, the first production region (observed), then the remaining regions |

| Resource | Value |
|---|---|
| Image | `verentis/smart-editor` in the shared registry, tagged `sha-<commit>`, deployed by digest |
| Namespace | The platform-provisioned apps namespace of each target cluster |
| Production URL | `https://smart-editor.apps.verentis.io` (region-free; the edge routes to the owning region) |
| Health check | `GET /` on the target's own ingress |

[`k8s/deployment.yaml`](k8s/deployment.yaml) is rendered per target (`__APP__`, `__HOST__`, `__IMAGE__`,
`__NAMESPACE__`, `__TLS_SECRET__`); the Ingress uses the platform's wildcard certificate for the apps domain. The
package's `environments/feature.yaml` and `environments/production.yaml` point `entry` at the matching host.

Azure, cluster and registry settings come from the repository's `feature` and `production-<region>` GitHub
environments, created by the platform's repository bootstrap; nothing is hard-coded in the workflows.

## Local image build

```bash
docker build -t smart-editor:dev .
```
