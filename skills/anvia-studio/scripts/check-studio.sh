#!/bin/sh
# Heuristic checks for Anvia Studio code in an app directory.
# Usage: sh scripts/check-studio.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "studio OK".

DIR="."
if [ "$1" = "--dir" ] && [ -n "$2" ]; then
  DIR="$2"
fi

ROOTS_FOUND=0
for root in "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server"; do
  if [ -d "$root" ]; then
    ROOTS_FOUND=1
    break
  fi
done
if [ "$ROOTS_FOUND" -eq 0 ]; then
  echo "ERROR: no src/app/lib/server directory under '$DIR' — nothing was checked."
  echo "Run from the app root or pass --dir <app-root>."
  exit 1
fi

fail=0
violation() {
  echo "VIOLATION: $1"
  fail=1
}
warning() {
  echo "WARNING: $1"
}

FILES=$(grep -rln --include='*.ts' \
  -e 'new Studio(' -e '@anvia/studio' \
  "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null | sort -u)

if [ -z "$FILES" ]; then
  echo "studio OK (no Studio code found)"
  exit 0
fi

# 1. Studio must serve something.
if echo "$FILES" | xargs grep -h -e 'new Studio(' 2>/dev/null | grep -q -e 'new Studio(\s*\[\s*\]' -e 'new Studio(\s*)'; then
  violation "new Studio with no registered agents/teams (see references/serve.md)."
fi

# 2. Observability clients are caller-owned: close them in onShutdown (warning only).
if echo "$FILES" | xargs grep -l -e '@anvia/langfuse' -e '@anvia/otel' -e '@anvia/lens' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -e 'onShutdown' 2>/dev/null | grep -q 'onShutdown' || {
    warning "observability clients without onShutdown — they will leak on exit (see references/observe.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "studio OK"
  exit 0
fi
echo "See skills/anvia-studio/references/ for fixes."
exit 1
