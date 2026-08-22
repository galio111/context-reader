#!/usr/bin/env sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 RUNTIME_OPS_DIR BACKUP_DUMP MIGRATION_SQL" >&2
  exit 2
fi

RUNTIME_DIR=$1
BACKUP_FILE=$2
MIGRATION_FILE=$3
VERIFY_DB=context_reader_invitation_check
VERIFY_USER=${VERIFY_USER:-supabase_admin}

test -f "$RUNTIME_DIR/.env"
test -s "$BACKUP_FILE"
test -s "$BACKUP_FILE.sha256"
test -s "$MIGRATION_FILE"

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

cat "$MIGRATION_FILE" | compose exec -T postgres psql \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB" --set ON_ERROR_STOP=1

cat <<'SQL' | compose exec -T postgres psql \
  --username "$VERIFY_USER" --dbname "$VERIFY_DB" --set ON_ERROR_STOP=1
do $$
declare
  v_user uuid;
  v_first_ends timestamptz;
  v_second_ends timestamptz;
begin
  select ap.user_id into v_user
  from public.account_profiles ap
  where ap.status = 'active'
  order by ap.created_at
  limit 1;

  if v_user is null then
    raise exception 'no active account is available in the restored backup';
  end if;

  update public.user_entitlements
  set plan_id = 'free', source = 'signup', starts_at = now(), ends_at = null
  where user_id = v_user;

  insert into public.invitation_codes (code_hash, code_hint, plan_id, duration_days, note)
  values (repeat('a', 64), '末四位 TEST', 'basic', 7, 'isolated migration verification');

  perform * from public.redeem_invitation_code(v_user, repeat('a', 64));
  select ends_at into v_first_ends from public.user_entitlements where user_id = v_user;
  if not exists (
    select 1 from public.user_entitlements
    where user_id = v_user and plan_id = 'basic' and source = 'invite'
      and ends_at > now() + interval '6 days 23 hours'
  ) then
    raise exception 'first invitation did not grant Basic for seven days';
  end if;

  begin
    perform * from public.redeem_invitation_code(v_user, repeat('a', 64));
    raise exception 'reused invitation unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'invitation_code_redeemed' then raise; end if;
  end;

  insert into public.invitation_codes (code_hash, code_hint, plan_id, duration_days, note)
  values (repeat('b', 64), '末四位 NEXT', 'plus', 14, 'active grant rejection verification');
  begin
    perform * from public.redeem_invitation_code(v_user, repeat('b', 64));
    raise exception 'overlapping invitation unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'active_invitation_entitlement' then raise; end if;
  end;

  update public.user_entitlements set ends_at = now() - interval '1 minute' where user_id = v_user;
  perform * from public.redeem_invitation_code(v_user, repeat('b', 64));
  select ends_at into v_second_ends from public.user_entitlements where user_id = v_user;
  if not exists (
    select 1 from public.user_entitlements
    where user_id = v_user and plan_id = 'plus' and source = 'invite'
      and ends_at > now() + interval '13 days 23 hours'
  ) then
    raise exception 'new invitation did not grant Plus after the previous grant expired';
  end if;
  if v_second_ends <= v_first_ends then
    raise exception 'second grant expiry was not refreshed';
  end if;
end;
$$;

select plan_id, source, ends_at > now() as active
from public.user_entitlements
where source = 'invite'
order by updated_at desc
limit 1;
SQL

echo "invitation-code migration and redemption verification passed"
