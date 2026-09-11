#!/bin/sh
# Heuristic checks for Anvia channels code in an app directory.
# Usage: sh scripts/check-channels.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "channels OK".

DIR="."
if [ "$1" = "--dir" ] && [ -n "$2" ]; then
  DIR="$2"
fi

fail=0
violation() {
  echo "VIOLATION: $1"
  fail=1
}
warning() {
  echo "WARNING: $1"
}

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

scan() {
  # $1 = include pattern; prints matching files under the usual roots.
  grep -rln --include="$1" \
    -e 'createChannelAgent(' -e 'serveChannelAgent(' -e 'sendChannelMessage(' \
    -e 'ChannelAgentService' -e 'ChannelEventHandler' -e 'ChannelInteractionStore' \
    -e 'telegram(' -e 'discord(' -e 'slack(' \
    "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null
}

FILES=$( { scan '*.ts'; scan '*.tsx'; } | sort -u)

if [ -z "$FILES" ]; then
  echo "channels OK (no channel code found)"
  exit 0
fi

# 1. Platform credentials come from the environment, never literals.
creds=$(echo "$FILES" | xargs grep -l -E '(appToken|botToken|token): *"' 2>/dev/null)
if [ -n "$creds" ]; then
  violation "hardcoded channel credential in $(echo "$creds" | tr '\n' ' ') — read tokens from the environment (see references/adapters.md)."
fi

# 2. Unbounded text must go through sendChannelMessage (it splits), not channel.send.
if echo "$FILES" | xargs grep -E '\.send\(\{[^}]*\$\{' 2>/dev/null | grep -q .; then
  violation "dynamic text through channel.send() can be truncated — use sendChannelMessage() so long text splits (see references/delivery.md)."
fi

# 3. The bridge swallows errors unless onError reports them (warning only).
if echo "$FILES" | xargs grep -l 'createChannelAgent(' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -l 'onError:' 2>/dev/null | grep -q . || {
    warning "createChannelAgent without onError anywhere — stage failures will be silent (see references/channel-agent.md)."
  }
fi

# 4. A started service needs a visible shutdown path (warning only).
if echo "$FILES" | xargs grep -q -E '(service|channelAgent|agent)\.start\(\)' 2>/dev/null; then
  echo "$FILES" | xargs grep -q -E 'stop\(\)|SIGINT|SIGTERM|process\.once|process\.on' 2>/dev/null || {
    warning "service.start() without a visible stop()/signal handler — add a shutdown path (see references/channel-agent.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "channels OK"
  exit 0
fi
echo "See skills/anvia-channels/references/ for fixes."
exit 1
