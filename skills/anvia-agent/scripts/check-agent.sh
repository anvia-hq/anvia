#!/bin/sh
# Heuristic checks for Anvia agent/tool code in an app directory.
# Usage: sh scripts/check-agent.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "agent OK".

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

scan() {
  # $1 = include pattern; prints matching files under the usual roots.
  grep -rln --include="$1" -e 'new Agent(' -e 'new AgentTeam(' -e 'createTool(' -e '.asTool(' \
    "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null
}

FILES=$( { scan '*.ts'; scan '*.tsx'; } | sort -u)

if [ -z "$FILES" ]; then
  echo "agent OK (no Agent/tool code found)"
  exit 0
fi

# 1. createTool requires a zod inputSchema at the boundary.
violations=$(echo "$FILES" | while IFS= read -r f; do
  awk -v file="$f" '
    /createTool\(/ { in_tool=1; buf=""; depth=0 }
    in_tool { buf=buf "\n" $0; depth+=gsub(/\(/,"(")-gsub(/\)/,")") }
    in_tool && depth<=0 && length(buf)>0 {
      if (buf !~ /inputSchema/) print "VIOLATION: " file ": createTool without inputSchema (see references/tools.md)."
      in_tool=0
    }
  ' "$f"
done)
if [ -n "$violations" ]; then
  echo "$violations"
  fail=1
fi

# 2. asTool requires an explicit suspension policy.
if echo "$FILES" | xargs grep -h -A4 '.asTool(' 2>/dev/null | grep -q 'asTool('; then
  echo "$FILES" | xargs grep -h -A4 '.asTool(' 2>/dev/null | grep -q 'suspension' || {
    violation "agent.asTool without suspension policy (see references/agent-options.md)."
  }
fi

# 3. new Agent requires id and model.
if echo "$FILES" | xargs grep -h -B1 -A8 'new Agent(' 2>/dev/null | grep -q 'new Agent('; then
  echo "$FILES" | xargs grep -h -B1 -A8 'new Agent(' 2>/dev/null | grep -q 'id:' || {
    violation "new Agent without id (see references/agent-options.md)."
  }
  echo "$FILES" | xargs grep -h -B1 -A8 'new Agent(' 2>/dev/null | grep -q 'model' || {
    violation "new Agent without model (see references/providers.md)."
  }
fi

# 4. Sensitive tool names without requiresApproval (warning only).
if echo "$FILES" | xargs grep -l -i -e 'name: *"[^"]*\(delete\|refund\|payment\|payroll\)' 2>/dev/null | grep -q .; then
  hit=$(echo "$FILES" | xargs grep -l -i -e 'name: *"[^"]*\(delete\|refund\|payment\|payroll\)' 2>/dev/null)
  echo "$hit" | xargs grep -L 'requiresApproval' 2>/dev/null | grep -q . && {
    warning "sensitive tool without requiresApproval (see references/tools.md)."
  }
fi

# 5. AgentTeam requires a members array.
if echo "$FILES" | xargs grep -l 'new AgentTeam(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A10 'new AgentTeam(' 2>/dev/null | grep -q 'members' || {
    violation "new AgentTeam without members (see references/teams.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "agent OK"
  exit 0
fi
echo "See skills/anvia-agent/references/ for fixes."
exit 1
