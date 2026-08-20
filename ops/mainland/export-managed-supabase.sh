#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 CONNECTION_ENV_FILE" >&2
  exit 64
fi

connection_file=$(readlink -f "$1")
import_root=/var/backups/context-reader/import
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$import_root/managed-supabase-$timestamp.data.dump"

if [[ "$connection_file" != "$import_root"/* || ! -f "$connection_file" ]]; then
  echo "connection env file must be inside $import_root" >&2
  exit 65
fi
if [[ "$(stat -c '%a' "$connection_file")" != 600 ]]; then
  echo "connection env file must have mode 600" >&2
  exit 65
fi

umask 077
mkdir -p "$import_root"

sudo docker run --rm \
  --env-file "$connection_file" \
  -v "$import_root:/backup" \
  supabase/postgres:17.6.1.136 \
  sh -lc 'exec pg_dump "$MANAGED_DATABASE_URL" "$@"' sh \
    --format=custom \
    --compress=6 \
    --data-only \
    --no-owner \
    --no-privileges \
    --table=public.account_profiles \
    --table=public.quota_plans \
    --table=public.quota_plan_limits \
    --table=public.account_settings \
    --table=public.user_entitlements \
    --table=public.guest_identities \
    --table=public.usage_counters \
    --table=public.usage_actions \
    --table=public.usage_executions \
    --table=public.user_data_objects \
    --table=public.admin_audit_logs \
    --table=public.public_articles \
    --table=public.public_explanations \
    --table=public.public_article_translations \
    --table=auth.instances \
    --table=auth.users \
    --table=auth.identities \
    --table=storage.buckets \
    --table=storage.objects \
    --file="/backup/$(basename "$output")"

test -s "$output"
sudo chown root:root "$output"
sudo chmod 600 "$output"
sha256sum "$output" > "$output.sha256"
sudo chmod 600 "$output.sha256"
sudo docker run --rm -v "$import_root:/backup:ro" supabase/postgres:17.6.1.136 \
  pg_restore --list "/backup/$(basename "$output")" >/dev/null

echo "$output"
