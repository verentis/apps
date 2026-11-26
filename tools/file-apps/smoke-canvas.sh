#!/usr/bin/env bash
# Renders generated app pages in the real Canvas runtime (data graph, actions, components).
# Needs a Canvas checkout beside this repository, or CANVAS_REPO pointing at one.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canvas="${CANVAS_REPO:-$here/../../../canvas}"
target="$canvas/packages/components/test/apps-smoke.spec.ts"
cp "$here/canvas-smoke.spec.ts" "$target"
trap 'rm -f "$target"' EXIT
cd "$canvas"
APPS_PACKAGES="$here/../../packages" npx vitest run packages/components/test/apps-smoke.spec.ts "$@"
