#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 SOURCE_DUMP" >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dump=$(readlink -f "$1")
compose=(docker compose --env-file "$script_dir/.env" -f "$script_dir/compose.yml" -f "$script_dir/compose.shadow.yml")

if [[ ! -f "$source_dump" || ! -s "$source_dump" ]]; then
  echo "source dump is missing or empty: $source_dump" >&2
  exit 66
fi
if [[ ! -f "$script_dir/.env" || ! -f "$script_dir/.env.runtime" ]]; then
  echo "deployment environment files are missing" >&2
  exit 66
fi
if [[ "$source_dump" != /var/backups/context-reader/import/* ]]; then
  echo "source dump must be staged under /var/backups/context-reader/import" >&2
  exit 65
fi

set -a
# shellcheck disable=SC1091
source "$script_dir/.env"
set +a

required=(POSTGRES_DB POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY PUBLIC_SITE_URL SUPABASE_PUBLIC_URL)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" || "${!name}" == generate_* ]]; then
    echo "missing generated secret or URL: $name" >&2
    exit 66
  fi
done
if [[ "$POSTGRES_DB" != postgres ]]; then
  echo "POSTGRES_DB must be postgres for the self-hosted Supabase schema" >&2
  exit 65
fi

umask 077
mkdir -p /var/backups/context-reader/pre-cutover
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
cp "$script_dir/.env" "/var/backups/context-reader/pre-cutover/env-$timestamp"
cp "$script_dir/.env.runtime" "/var/backups/context-reader/pre-cutover/env-runtime-$timestamp"

echo "[1/9] starting isolated Supabase-compatible database"
"${compose[@]}" stop postgres >/dev/null 2>&1 || true
"${compose[@]}" up -d postgres
"${compose[@]}" exec -T postgres sh -lc 'until pg_isready -U postgres -d postgres; do sleep 1; done'

echo "[2/9] bootstrapping current Auth and Storage schemas"
"${compose[@]}" up -d auth rest storage supabase-api
"${compose[@]}" stop supabase-api storage rest auth

echo "[3/9] applying authoritative Context Reader schemas and grants"
"${compose[@]}" exec -T postgres psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 < "$script_dir/../../docs/public-articles-supabase.sql"
"${compose[@]}" exec -T postgres psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 < "$script_dir/../../docs/account-usage-supabase.sql"

echo "[4/9] clearing only the tables represented by the data-only source dump"
"${compose[@]}" exec -T postgres psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
truncate table
  public.admin_audit_logs,
  public.usage_executions,
  public.usage_actions,
  public.usage_counters,
  public.user_data_objects,
  public.guest_identities,
  public.user_entitlements,
  public.account_settings,
  public.account_profiles,
  public.quota_plan_limits,
  public.quota_plans,
  public.public_article_translations,
  public.public_explanations,
  public.public_articles
cascade;
truncate table auth.identities, auth.users, auth.instances cascade;
truncate table storage.objects, storage.buckets cascade;
SQL

echo "[5/9] restoring the data-only source dump"
case "$source_dump" in
  *.sql.gz)
    gzip -dc "$source_dump" | "${compose[@]}" exec -T postgres \
      psql --username supabase_admin --dbname postgres --set ON_ERROR_STOP=1
    ;;
  *)
    "${compose[@]}" exec -T postgres pg_restore \
      --username supabase_admin \
      --dbname postgres \
      --data-only \
      --disable-triggers \
      --no-owner \
      --no-privileges \
      --exit-on-error < "$source_dump"
    ;;
esac

"${compose[@]}" exec -T postgres psql --username supabase_admin --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  item record;
begin
  for item in
    select
      format('%I.%I', sequence_schema, sequence_name) as sequence_name,
      format('%I.%I', table_schema, table_name) as table_name,
      column_name
    from information_schema.sequences seq
    join information_schema.columns column_info
      on pg_get_serial_sequence(
        format('%I.%I', column_info.table_schema, column_info.table_name),
        column_info.column_name
      ) = format('%I.%I', seq.sequence_schema, seq.sequence_name)
    where column_info.table_schema in ('public', 'auth', 'storage')
  loop
    execute format(
      'select setval(%L, coalesce(max(%I), 1), max(%I) is not null) from %s',
      item.sequence_name,
      item.column_name,
      item.column_name,
      item.table_name
    );
  end loop;
end
$$;
SQL

# Managed Supabase keeps object bytes outside Postgres. Until those private
# bytes can be copied, do not leave metadata rows that point at missing local
# files. Buckets remain present and cache objects can be regenerated normally.
"${compose[@]}" exec -T postgres psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
truncate table storage.objects cascade;
SQL

echo "[6/9] starting Auth, REST and Storage"
"${compose[@]}" up -d auth rest storage supabase-api

echo "[7/9] checking migrated row counts"
"${compose[@]}" exec -T postgres psql --username postgres --dbname postgres --tuples-only --no-align <<'SQL'
select 'auth.users=' || count(*) from auth.users;
select 'account_profiles=' || count(*) from public.account_profiles;
select 'user_data_objects=' || count(*) from public.user_data_objects;
select 'public_articles=' || count(*) from public.public_articles;
SQL

echo "[8/9] building the exact application release that owns this migration"
docker build \
  --pull=false \
  --file "$script_dir/Dockerfile" \
  --tag context-reader-app:latest \
  "$script_dir/../.."

echo "[9/9] switching only the shadow app"
"${compose[@]}" up -d --no-build --force-recreate app caddy

echo "verifying shadow endpoints"
"$script_dir/verify-shadow-runtime.sh"

"$script_dir/backup-postgres.sh"
echo "self-hosted backend activated in shadow mode"
