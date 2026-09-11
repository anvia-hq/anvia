#!/bin/sh
# Heuristic checks for Anvia Pipeline code in an app directory.
# Usage: sh scripts/check-pipeline.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "pipeline OK".

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
  -e 'new Pipeline(' \
  "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null | sort -u)

if [ -z "$FILES" ]; then
  echo "pipeline OK (no Pipeline code found)"
  exit 0
fi

# 1. Pipelines need an id and a zod inputSchema (constructor throws without a schema).
if echo "$FILES" | xargs grep -h -A4 'new Pipeline(' 2>/dev/null | grep -q 'new Pipeline('; then
  echo "$FILES" | xargs grep -h -A4 'new Pipeline(' 2>/dev/null | grep -q 'id:' || {
    violation "new Pipeline without id (see references/steps-compose.md)."
  }
  echo "$FILES" | xargs grep -h -A4 'new Pipeline(' 2>/dev/null | grep -q 'inputSchema' || {
    violation "new Pipeline without inputSchema (see references/steps-compose.md)."
  }
fi

# 2. Agent stages require an explicit suspension policy.
if echo "$FILES" | xargs grep -l '\.agent(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A6 '\.agent(' 2>/dev/null | grep -q 'suspension' || {
    violation "pipeline .agent stage without suspension (see references/agents-extract.md)."
  }
fi

# 3. A pipeline with no stages runs nothing (warning only).
if echo "$FILES" | xargs grep -L -e '\.step(' -e '\.compose(' -e '\.agent(' -e '\.parallel(' -e '\.extract(' 2>/dev/null | grep -q .; then
  warning "Pipeline file defines no stages — check for an unfinished pipeline (see references/steps-compose.md)."
fi

if [ "$fail" -eq 0 ]; then
  echo "pipeline OK"
  exit 0
fi
echo "See skills/anvia-pipeline/references/ for fixes."
exit 1
