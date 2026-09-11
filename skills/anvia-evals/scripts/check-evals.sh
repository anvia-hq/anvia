#!/bin/sh
# Heuristic checks for Anvia eval code in an app directory.
# Usage: sh scripts/check-evals.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "evals OK".

DIR="."
if [ "$1" = "--dir" ] && [ -n "$2" ]; then
  DIR="$2"
fi

ROOTS_FOUND=0
for root in "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" "$DIR/evals"; do
  if [ -d "$root" ]; then
    ROOTS_FOUND=1
    break
  fi
done
if [ "$ROOTS_FOUND" -eq 0 ]; then
  echo "ERROR: no src/app/lib/server/evals directory under '$DIR' — nothing was checked."
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
  -e 'runEvalSuite' -e 'runEvalCli' -e 'llmJudge' -e 'llmScore' -e 'gEval(' \
  "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" "$DIR/evals" 2>/dev/null | sort -u)

if [ -z "$FILES" ]; then
  echo "evals OK (no eval code found)"
  exit 0
fi

# 1. Eval runs need a stable name (history and expectations key off it).
if echo "$FILES" | xargs grep -l -e 'runEvalSuite' -e 'runEvalCli' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A6 -e 'runEvalSuite(' -e 'runEvalCli(' 2>/dev/null | grep -q 'name:' || {
    violation "runEvalSuite/runEvalCli without name (see references/running.md)."
  }
fi

# 2. llmScore needs a threshold; llmJudge needs a passes predicate.
if echo "$FILES" | xargs grep -l 'llmScore(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A8 'llmScore(' 2>/dev/null | grep -q 'threshold' || {
    violation "llmScore without threshold (see references/judges.md)."
  }
fi
if echo "$FILES" | xargs grep -l 'llmJudge(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A8 'llmJudge(' 2>/dev/null | grep -q 'passes' || {
    violation "llmJudge without passes predicate (see references/judges.md)."
  }
fi

# 3. CI runs should fail the build on regression (warning only).
if echo "$FILES" | xargs grep -l 'runEvalCli' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A20 'runEvalCli(' 2>/dev/null | grep -q 'exitCode' || {
    warning "runEvalCli without exitCode will not fail CI (see references/running.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "evals OK"
  exit 0
fi
echo "See skills/anvia-evals/references/ for fixes."
exit 1
