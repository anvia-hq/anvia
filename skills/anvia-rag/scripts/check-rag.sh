#!/bin/sh
# Heuristic checks for Anvia retrieval/RAG code in an app directory.
# Usage: sh scripts/check-rag.sh [--dir <app-root>]
# Fails with a list of violations; passes silently with "rag OK".

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
  -e 'embedDocuments' -e 'retrieveDocuments' -e 'createVectorSearchTool' -e 'createGraphSearchTool' -e 'vectorStore' \
  "$DIR/src" "$DIR/app" "$DIR/lib" "$DIR/server" 2>/dev/null | sort -u)

if [ -z "$FILES" ]; then
  echo "rag OK (no retrieval code found)"
  exit 0
fi

# 1. embedDocuments needs explicit id/content/metadata selectors.
if echo "$FILES" | xargs grep -l 'embedDocuments' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A8 'embedDocuments(' 2>/dev/null | grep -q 'content:' || {
    violation "embedDocuments without content selector (see references/pipeline.md)."
  }
fi

# 2. Client vector stores need dimensions matching the embedding model.
if echo "$FILES" | xargs grep -l 'vectorStore' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A5 'vectorStore' 2>/dev/null | grep -q 'dimensions' || {
    violation "vectorStore without dimensions (see references/stores.md)."
  }
fi

# 3. One search tool per corpus needs a routing description (warning: a generic default exists).
if echo "$FILES" | xargs grep -l 'createVectorSearchTool' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A7 'createVectorSearchTool(' 2>/dev/null | grep -q 'description' || {
    warning "createVectorSearchTool without description falls back to a generic default (see references/rag-tool.md)."
  }
fi

# 4. Graph search tools have no default description — one is required.
if echo "$FILES" | xargs grep -l 'createGraphSearchTool' 2>/dev/null | grep -q .; then
  echo "$FILES" | xargs grep -h -A7 'createGraphSearchTool(' 2>/dev/null | grep -q 'description' || {
    violation "createGraphSearchTool without description (see references/graph-rag.md)."
  }
fi

if [ "$fail" -eq 0 ]; then
  echo "rag OK"
  exit 0
fi
echo "See skills/anvia-rag/references/ for fixes."
exit 1
