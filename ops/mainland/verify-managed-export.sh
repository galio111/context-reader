#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 SOURCE_DUMP" >&2
  exit 64
fi

source_dump=$(readlink -f "$1")
case "$source_dump" in
  /var/backups/context-reader/import/managed-supabase-*.data.dump) ;;
  *) echo "unexpected managed dump path" >&2; exit 65 ;;
esac

cd "$(dirname "$source_dump")"
sha256sum -c "$(basename "$source_dump").sha256"
docker run --rm \
  -v /var/backups/context-reader/import:/backup:ro \
  supabase/postgres:17.6.1.136 \
  pg_restore --list "/backup/$(basename "$source_dump")" >/dev/null
stat -c '%a %U %G %s' "$source_dump"
