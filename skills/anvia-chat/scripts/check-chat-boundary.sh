#!/bin/sh
# Check the Anvia chat boundary rules in the current app directory.
# Usage: sh scripts/check-chat-boundary.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "chat boundary OK".

DIR="."
if [ "$1" = "--dir" ] && [ -n "$2" ]; then
  DIR="$2"
fi

ROOTS_FOUND=0
for root in "$DIR/src" "$DIR/app" "$DIR/components"; do
  if [ -d "$root" ]; then
    ROOTS_FOUND=1
    break
  fi
done
if [ "$ROOTS_FOUND" -eq 0 ]; then
  echo "ERROR: no src/app/components directory under '$DIR' — nothing was checked."
  echo "Run from the app root or pass --dir <app-root>."
  exit 1
fi

fail=0
violation() {
  echo "VIOLATION: $1"
  fail=1
}

# 1. Client bundle must not import the Agent runtime or server framing helpers.
if grep -rn --include='*.ts' --include='*.tsx' \
  -e 'from "@anvia/core/agent"' \
  -e 'from "@anvia/server"' \
  "$DIR/src" "$DIR/app" "$DIR/components" 2>/dev/null | grep -v '^Binary' | grep -q .; then
  violation "client code imports @anvia/core/agent runtime or @anvia/server; keep AgentContinuation and framing server-side (see references/transports-state.md)."
fi

# 2. useChat/useCompletion require an explicit transport.
if grep -rln --include='*.tsx' --include='*.ts' \
  -e 'useChat(' -e 'useCompletion(' "$DIR/src" "$DIR/app" "$DIR/components" 2>/dev/null | grep -q .; then
  if ! grep -rn --include='*.tsx' --include='*.ts' \
    -e 'createHttpClientTransport' -e 'createDirectClientTransport' \
    "$DIR/src" "$DIR/app" "$DIR/components" 2>/dev/null | grep -q .; then
    violation "useChat/useCompletion used without createHttpClientTransport or createDirectClientTransport (see references/react-ui.md)."
  fi
fi

# 3. UIMessage must not be sent to the server; requests carry core Message[].
if grep -rn --include='*.ts' --include='*.tsx' \
  -e 'UIMessage\[\].*fetch' -e 'body:.*UIMessage' -e 'JSON.stringify(.*uiMessages\|.*messages: chat.messages)' \
  "$DIR/src" "$DIR/app" 2>/dev/null | grep -q .; then
  violation "possible UIMessage sent over the wire; convert with uiMessagesToMessages first (see references/transports-state.md)."
fi

# 4. Server route must validate the request and claim (or not claim) the protocol.
if grep -rln --include='*.ts' \
  -e 'createClientStreamResponse' -e 'agentToClientStream' -e 'completionToClientStream' \
  "$DIR/src" "$DIR/app" 2>/dev/null | grep -q .; then
  if ! grep -rn --include='*.ts' -e 'parseClientStreamRequest' \
    "$DIR/src" "$DIR/app" 2>/dev/null | grep -q .; then
    violation "stream route does not call parseClientStreamRequest (see references/server-protocol.md)."
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "chat boundary OK"
  exit 0
fi
echo "See skills/anvia-chat/references/ for fixes."
exit 1
