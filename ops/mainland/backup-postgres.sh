#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set -a
. "$SCRIPT_DIR/.env"
set +a
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/context-reader/postgres}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DAY_OF_WEEK=$(date -u +%u)
DAY_OF_MONTH=$(date -u +%d)
compose() {
  docker compose --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/compose.yml" "$@"
}

umask 077
mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly"
TMP_FILE="$BACKUP_ROOT/.context-reader-$TIMESTAMP.dump.tmp"
DAILY_FILE="$BACKUP_ROOT/daily/context-reader-$TIMESTAMP.dump"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT INT TERM

compose exec -T postgres pg_dump \
  --username "${POSTGRES_USER:-postgres}" \
  --dbname "${POSTGRES_DB:-postgres}" \
  --format custom \
  --compress 6 > "$TMP_FILE"

test -s "$TMP_FILE"
mv "$TMP_FILE" "$DAILY_FILE"
sha256sum "$DAILY_FILE" > "$DAILY_FILE.sha256"

if [ "$DAY_OF_WEEK" = "7" ]; then
  cp "$DAILY_FILE" "$BACKUP_ROOT/weekly/"
  cp "$DAILY_FILE.sha256" "$BACKUP_ROOT/weekly/"
fi

if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$DAILY_FILE" "$BACKUP_ROOT/monthly/"
  cp "$DAILY_FILE.sha256" "$BACKUP_ROOT/monthly/"
fi

find "$BACKUP_ROOT/daily" -type f -mtime +7 -delete
find "$BACKUP_ROOT/weekly" -type f -mtime +35 -delete
find "$BACKUP_ROOT/monthly" -type f -mtime +370 -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  docker run --rm \
    -v "$BACKUP_ROOT:/data:ro" \
    -v "${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}:/config/rclone/rclone.conf:ro" \
    rclone/rclone:1.70 copy /data "$RCLONE_REMOTE" --checksum --transfers 2
fi

printf '%s\n' "$DAILY_FILE"
