#!/usr/bin/env bash
# One command, from a fresh clone to "this is what will be judged".
# The exit code is the verdict.

set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
echo "node $(node -v), npm $(npm -v)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node 20.19 or newer is required (Vite 8)." >&2
  exit 1
fi

# Parallel vitest workers have produced false greens on this machine: they share
# one temp file, the loser gets EPERM, and that test file never loads. One
# worker, temp inside the repo, and the count is checked below.
export TEMP="$PWD/.tmp"
export TMP="$PWD/.tmp"
mkdir -p "$TEMP"

step "install"
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund
else
  echo "node_modules present"
fi

step "type check"
npx tsc --noEmit

step "unit tests"
TEST_LOG="$TEMP/vitest.log"
NO_COLOR=1 FORCE_COLOR=0 npx vitest run 2>&1 | tee "$TEST_LOG"
PASSED=$(sed -E 's/\x1b\[[0-9;]*m//g' "$TEST_LOG" | grep -Eo 'Tests +[0-9]+ passed' | grep -Eo '[0-9]+' | tail -1 || true)
if [ -z "${PASSED:-}" ] || [ "$PASSED" -lt 60 ]; then
  echo "expected at least 60 passing tests, counted ${PASSED:-0} — a file probably failed to load" >&2
  exit 1
fi
echo "$PASSED tests passed"

step "build"
npx vite build

step "end to end in a real browser"
node scripts/e2e.mjs

step "ui measurement"
node scripts/measure-ui.mjs > /dev/null
echo "proof/ui/report.md updated"

step "hygiene"
if grep -rn --include='*.ts' --include='*.mjs' -E 'TODO|FIXME|XXX' src scripts test | grep -v 'no TODO'; then
  echo "leftover TODO/FIXME above" >&2
  exit 1
fi
if grep -rIn --include='*.ts' -E 'sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' src; then
  echo "a secret is in the source" >&2
  exit 1
fi
# The Relate engine ships as a 6.9 MB WebAssembly module; that is the product,
# not bloat. Everything else has to stay small.
BIG=$(find dist -type f -size +1M ! -name "*.wasm" | head -5)
if [ -n "$BIG" ]; then
  echo "unexpectedly large asset(s):" >&2
  echo "$BIG" >&2
  exit 1
fi
if ! ls dist/assets/*.wasm > /dev/null 2>&1; then
  echo "the Relate engine is missing from the bundle" >&2
  exit 1
fi

printf '\n\033[1;32mverify: all green\033[0m\n'
