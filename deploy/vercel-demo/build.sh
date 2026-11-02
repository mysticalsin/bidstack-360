#!/usr/bin/env bash
# Vercel build entry for the always-on public demo (project polo-presales).
#
# The deployment upload is only this folder plus a polo-sha.txt naming the
# commit to ship. The repo is public, so the build clones that exact commit,
# installs, and writes .vercel/output next to this script via
# scripts/vercel-serverless-build.mjs. No secrets are read or printed here;
# runtime values come from the project's environment variables.
set -euo pipefail

HERE="$(pwd)"
SHA="$(tr -d '[:space:]' < polo-sha.txt)"
REPO="${POLO_REPO_URL:-https://github.com/mysticalsin/bidstack-360.git}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "polo-sha.txt must hold a full commit SHA" >&2; exit 1; }

echo "[demo-build] cloning ${REPO} at ${SHA}"
rm -rf "$HERE/src"
git init -q "$HERE/src"
cd "$HERE/src"
git remote add origin "$REPO"
git fetch -q --depth 1 origin "$SHA"
git checkout -q FETCH_HEAD

echo "[demo-build] installing"
npm install -g pnpm@10.27.0 --silent
pnpm install --frozen-lockfile
npm install --prefix /tmp/polo-nft --no-save --silent @vercel/nft@0.29

echo "[demo-build] building"
VERCEL_OUTPUT_DIR="$HERE/.vercel/output" NFT_PATH=/tmp/polo-nft node scripts/vercel-serverless-build.mjs
