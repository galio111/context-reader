begin;

alter table public.user_entitlements drop constraint if exists user_entitlements_source_check;
alter table public.user_entitlements add constraint user_entitlements_source_check
  check (source in ('signup', 'admin', 'payment', 'promotion', 'invite'));

create table if not exists public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (char_length(code_hash) = 64),
  code_hint text not null default '',
  plan_id text not null references public.quota_plans(id),
  duration_days integer not null check (duration_days between 1 and 3650),
  redeem_by timestamptz,
  note text not null default '',
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  grant_ends_at timestamptz,
  check (plan_id in ('basic', 'plus', 'max')),
  check (redeemed_at is null or redeemed_by is not null),
  check (grant_ends_at is null or redeemed_at is not null)
);

create index if not exists invitation_codes_created_idx
  on public.invitation_codes (created_at desc);
create index if not exists invitation_codes_redeemed_by_idx
  on public.invitation_codes (redeemed_by, redeemed_at desc)
  where redeemed_by is not null;

create or replace function public.redeem_invitation_code(
  p_user_id uuid,
  p_code_hash text
)
returns table (
  invitation_id uuid,
  granted_plan_id text,
  granted_starts_at timestamptz,
  granted_ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.invitation_codes%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_profile_status text;
  v_now timestamptz := clock_timestamp();
  v_ends_at timestamptz;
begin
  if p_user_id is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invitation_code_invalid';
  end if;

  select status into v_profile_status from public.account_profiles where user_id = p_user_id;
  if v_profile_status is null then raise exception 'account_not_found'; end if;
  if v_profile_status <> 'active' then raise exception 'account_not_active'; end if;

  select * into v_code from public.invitation_codes where code_hash = p_code_hash for update;
  if not found then raise exception 'invitation_code_invalid'; end if;
  if v_code.revoked_at is not null then raise exception 'invitation_code_revoked'; end if;
  if v_code.redeemed_at is not null then raise exception 'invitation_code_redeemed'; end if;
  if v_code.redeem_by is not null and v_code.redeem_by <= v_now then raise exception 'invitation_code_expired'; end if;

  select * into v_entitlement from public.user_entitlements where user_id = p_user_id for update;
  if found and v_entitlement.source = 'invite' and v_entitlement.ends_at is not null and v_entitlement.ends_at > v_now then
    raise exception 'active_invitation_entitlement';
  end if;
  if found and v_entitlement.plan_id <> 'free' and (v_entitlement.ends_at is null or v_entitlement.ends_at > v_now) then
    raise exception 'active_nonfree_entitlement';
  end if;

  v_ends_at := v_now + make_interval(days => v_code.duration_days);
  insert into public.user_entitlements (user_id, plan_id, source, starts_at, ends_at, updated_at)
  values (p_user_id, v_code.plan_id, 'invite', v_now, v_ends_at, v_now)
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    source = excluded.source,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_at = excluded.updated_at;

  update public.invitation_codes
  set redeemed_at = v_now, redeemed_by = p_user_id, grant_ends_at = v_ends_at
  where id = v_code.id;

  insert into public.admin_audit_logs (admin_label, action, target_type, target_id, after_value)
  values ('user-self-service', 'redeem_invitation_code', 'user', p_user_id::text,
    jsonb_build_object('invitationId', v_code.id, 'planId', v_code.plan_id, 'startsAt', v_now, 'endsAt', v_ends_at));

  return query select v_code.id, v_code.plan_id, v_now, v_ends_at;
end;
$$;

alter table public.invitation_codes enable row level security;
revoke all on public.invitation_codes from anon, authenticated, public;
revoke all on function public.redeem_invitation_code(uuid, text) from anon, authenticated, public;
grant execute on function public.redeem_invitation_code(uuid, text) to service_role;
grant select, insert, update on public.invitation_codes to service_role;

commit;
notify pgrst, 'reload schema';
