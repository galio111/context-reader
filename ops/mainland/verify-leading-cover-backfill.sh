#!/usr/bin/env sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: $0 RUNTIME_OPS_DIR BACKUP_DUMP BACKFILL_SQL CONTRACT_SQL" >&2
  exit 2
fi

RUNTIME_DIR=$1
BACKUP_FILE=$2
BACKFILL_FILE=$3
CONTRACT_FILE=$4
VERIFY_DB=context_reader_cover_check
VERIFY_USER=${VERIFY_USER:-supabase_admin}

test -f "$RUNTIME_DIR/.env"
test -s "$BACKUP_FILE"
test -s "$BACKUP_FILE.sha256"
test -s "$BACKFILL_FILE"
test -s "$CONTRACT_FILE"

set -a
. "$RUNTIME_DIR/.env"
set +a

compose() {
  docker compose --env-file "$RUNTIME_DIR/.env" -f "$RUNTIME_DIR/compose.yml" "$@"
}

cleanup() {
  compose exec -T postgres dropdb --if-exists --force --username "$VERIFY_USER" "$VERIFY_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

sha256sum -c "$BACKUP_FILE.sha256"
cleanup
compose exec -T postgres createdb --username "$VERIFY_USER" "$VERIFY_DB"
cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error --no-owner --no-privileges --section=pre-data \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB"
compose exec -T postgres psql --username "$VERIFY_USER" --dbname "$VERIFY_DB" \
  --set ON_ERROR_STOP=1 --command "grant all on table vault.secrets to $VERIFY_USER;"
cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error --no-owner --no-privileges --section=data \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB"
cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error --no-owner --no-privileges --section=post-data \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB"

cat "$BACKFILL_FILE" | compose exec -T postgres psql \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB" --set ON_ERROR_STOP=1
cat "$BACKFILL_FILE" | compose exec -T postgres psql \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB" --set ON_ERROR_STOP=1
cat "$CONTRACT_FILE" | compose exec -T postgres psql \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB" --set ON_ERROR_STOP=1

echo "leading cover backfill verification passed"
