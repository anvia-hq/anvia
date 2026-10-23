#!/bin/sh
# Builds the reference desktop image from this checkout, so it contains the daemon you are
# running the cookbook against rather than the last published @anvia/sandbox.
#
#   pnpm --filter cookbook remote-sandbox:image
#
# The result is tagged anvia-desktop (override with ANVIA_DESKTOP_IMAGE). It needs Docker.
set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
image="${ANVIA_DESKTOP_IMAGE:-anvia-desktop}"
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT

pnpm --dir "$root" --filter @anvia/sandbox build
pnpm --dir "$root" --filter @anvia/sandbox exec pnpm pack --pack-destination "$context" >/dev/null
tarball="$(cd "$context" && ls anvia-sandbox-*.tgz)"
cp -R "$root/packages/tool-sandbox/images/desktop/." "$context/"

docker build -t "$image" --build-arg "ANVIA_SANDBOX_PACKAGE=/ctx/$tarball" "$context"
echo "Built $image. Run: pnpm --filter cookbook remote-sandbox:01"
