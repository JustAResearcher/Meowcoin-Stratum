#!/usr/bin/env bash
# Run inside node:22 container to produce a Linux binary.
set -euo pipefail
cd /work
apt-get update -qq && apt-get install -y -qq python3 build-essential git >/dev/null
rm -rf node_modules dist
npm install --no-audit --no-fund --omit=optional 2>&1 | tail -5
npx pkg . --targets node22-linux-x64 --output dist/meowsolo
chmod +x dist/meowsolo
ls -lah dist/
file dist/meowsolo
