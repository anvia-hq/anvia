#!/bin/sh
# Heuristic checks for Anvia MCP code in an app directory.
# Usage: sh scripts/check-mcp.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "mcp OK".

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
  -e 'new McpClient(' -e 'McpClientGroup' -e 'mcpServers' \
  "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null | sort -u)

if [ -z "$FILES" ]; then
  echo "mcp OK (no MCP code found)"
  exit 0
fi

# 1. Every client needs a unique name.
if echo "$FILES" | xargs grep -l 'new McpClient(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A5 'new McpClient(' 2>/dev/null | grep -q 'name:' || {
    violation "new McpClient without name (see references/clients.md)."
  }
fi

# 2. Remote transports need an explicit URL.
if echo "$FILES" | xargs grep -l 'streamableHttp' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A6 'streamableHttp' 2>/dev/null | grep -q 'url:' || {
    violation "streamableHttp transport without url (see references/clients.md)."
  }
fi

# 3. Disabled SSRF protection must be intentional (warning only).
if echo "$FILES" | xargs grep -l 'ssrfProtection.*disabled' 2>/dev/null | grep -q .; then
  warning "ssrfProtection disabled — confirm the app owns that network boundary (see references/safety.md)."
fi

# 4. Connected clients should be closed (warning only).
if echo "$FILES" | xargs grep -l -e '\.connect(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -e '\.close(' 2>/dev/null | grep -q '.close(' || {
    warning "MCP connect without close — leak risk, use try/finally (see references/clients.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "mcp OK"
  exit 0
fi
echo "See skills/anvia-mcp/references/ for fixes."
exit 1
