#!/usr/bin/env bash
# Thin wrapper: install deps, build, register this checkout as a Cursor local plugin.
# Cross-platform registration logic lives in register-local-plugin.mjs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

echo "==> npm run register:local"
npm run register:local

echo ""
echo "Done. In Cursor: Developer → Reload Window"
echo "Then Customize → MCP Tools should list open-delegate."
