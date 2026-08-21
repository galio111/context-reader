#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /var/backups/context-reader/postgres/daily/context-reader-*.dump" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set -a
. "$SCRIPT_DIR/.env"
set +a
BACKUP_FILE=$1
VERIFY_DB=context_reader_restore_check
VERIFY_USER=${VERIFY_USER:-supabase_admin}
compose() {
  docker compose --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/compose.yml" "$@"
}

case "$BACKUP_FILE" in
  /var/backups/context-reader/postgres/*.dump|/var/backups/context-reader/postgres/*/*.dump) ;;
  *) echo "backup must stay inside /var/backups/context-reader/postgres" >&2; exit 2 ;;
esac

test -s "$BACKUP_FILE"
test -s "$BACKUP_FILE.sha256"
sha256sum -c "$BACKUP_FILE.sha256"

cleanup() {
  compose exec -T postgres dropdb --if-exists --force --username "$VERIFY_USER" "$VERIFY_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
compose exec -T postgres createdb --username "$VERIFY_USER" "$VERIFY_DB"
cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --section=pre-data \
  --username "$VERIFY_USER" \
  --dbname "$VERIFY_DB"

# The Vault extension creates its encrypted table with deliberately narrow
# privileges. Restore schema first, then grant the disposable verifier role
# access before COPY runs. This keeps the full Vault data in the restore test
# instead of hiding a broken backup behind an excluded schema.
compose exec -T postgres psql \
  --username "$VERIFY_USER" \
  --dbname "$VERIFY_DB" \
  --set ON_ERROR_STOP=1 \
  --command "grant all on table vault.secrets to $VERIFY_USER;"

cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --section=data \
  --username "$VERIFY_USER" \
  --dbname "$VERIFY_DB"

cat "$BACKUP_FILE" | compose exec -T postgres pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --section=post-data \
  --username "$VERIFY_USER" \
  --dbname "$VERIFY_DB"

compose exec -T postgres psql \
  --username "$VERIFY_USER" \
  --dbname "$VERIFY_DB" \
  --set ON_ERROR_STOP=1 \
  --command "select count(*) as restored_public_tables from information_schema.tables where table_schema = 'public';"

echo "restore verification passed"
