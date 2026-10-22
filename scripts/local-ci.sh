#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d node_modules ]]; then
  echo "node_modules is missing. Run 'npm install --ignore-scripts --no-audit --no-fund' first." >&2
  exit 2
fi

echo "[local-ci] typecheck"
npm run typecheck

echo "[local-ci] InnoForge tests"
npm run innoforge:test

echo "[local-ci] PASS"
