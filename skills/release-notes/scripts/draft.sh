#!/bin/sh
# Draft release-notes skeleton from a list of shipped changes (one argument,
# one change per line). The skill rewrites this skeleton into final notes.

changes="$1"

if [ -z "$changes" ]; then
  echo "usage: draft.sh \"<shipped changes, one per line>\"" >&2
  exit 1
fi

printf 'Draft release notes\n====================\n\n'
printf 'Summary: <one sentence covering the theme of these changes>\n\n'
printf 'Changes:\n'
printf '%s\n' "$changes" | while IFS= read -r line; do
  if [ -n "$line" ]; then
    case "$line" in
      "- "*) line="${line#- }" ;;
    esac
    printf -- '- %s\n' "$line"
  fi
done
