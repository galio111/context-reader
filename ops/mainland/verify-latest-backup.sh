#!/usr/bin/env sh
set -eu

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/context-reader/postgres}
LATEST_BACKUP=$(find "$BACKUP_ROOT/daily" -maxdepth 1 -type f -name 'context-reader-*.dump' -printf '%T@ %p\n' \
  | sort -nr \
  | sed -n '1s/^[^ ]* //p')

if [ -z "$LATEST_BACKUP" ]; then
  echo "no daily PostgreSQL backup is available" >&2
  exit 1
fi

exec "$(dirname "$0")/verify-backup.sh" "$LATEST_BACKUP"
