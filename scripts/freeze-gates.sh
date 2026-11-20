#!/bin/bash
# Writer gate and the CI unit job. Full workspace build, then the web vite
# build on its own so a node built-in or a server-only module fails here.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm -r build
pnpm --filter @bidstack/web build
