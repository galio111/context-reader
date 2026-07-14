create extension if not exists pgcrypto;

create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  nickname text not null default '',
  avatar_url text not null default '',
  english_level text not null default '',
  learning_goal text not null default '',
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_profiles add column if not exists email text not null default '';

create table if not exists public.quota_plans (
  id text primary key,
  display_name text not null,
  price_cny integer not null default 0 check (price_cny >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quota_plan_limits (
  plan_id text not null references public.quota_plans(id) on delete cascade,
  metric_key text not null,
  allowance bigint not null check (allowance >= 0),
  window_type text not null check (window_type in ('day', 'month')),
  updated_at timestamptz not null default now(),
  primary key (plan_id, metric_key)
);

create table if not exists public.account_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'free' references public.quota_plans(id),
  source text not null default 'signup' check (source in ('signup', 'admin', 'payment', 'promotion')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  bonus_limits jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_identities (
  id uuid primary key,
  status text not null default 'active' check (status in ('active', 'suspended')),
  last_ip_hash text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  owner_key text not null,
  metric_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  used_units bigint not null default 0 check (used_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_key, metric_key, window_start)
);

create table if not exists public.usage_actions (
  id uuid primary key,
  owner_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  guest_id uuid references public.guest_identities(id) on delete set null,
  plan_id text not null references public.quota_plans(id),
  feature text not null,
  metric_key text not null,
  quota_units bigint not null default 0 check (quota_units >= 0),
  counter_window_start timestamptz,
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'cached', 'failed', 'cancelled')),
  cache_hit boolean not null default false,
  error_code text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists usage_actions_owner_created_idx
  on public.usage_actions (owner_key, created_at desc);

create index if not exists usage_actions_user_created_idx
  on public.usage_actions (user_id, created_at desc)
  where user_id is not null;

create table if not exists public.usage_executions (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.usage_actions(id) on delete cascade,
  route text not null,
  provider text not null default '',
  model text not null default '',
  prompt_tokens bigint not null default 0,
  prompt_cache_hit_tokens bigint not null default 0,
  prompt_cache_miss_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  estimated_cost_microusd bigint not null default 0,
  status text not null check (status in ('succeeded', 'failed', 'cancelled')),
  error_code text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists usage_executions_action_idx
  on public.usage_executions (action_id, created_at);

create table if not exists public.user_data_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('article', 'vocabulary', 'explanation', 'article_translation', 'translation_block', 'reading_state', 'preferences')),
  object_key text not null,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  server_version bigint not null default 1,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, object_key)
);

create index if not exists user_data_objects_sync_idx
  on public.user_data_objects (user_id, updated_at, kind, object_key);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_label text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

insert into public.quota_plans (id, display_name, price_cny, sort_order)
values
  ('guest', '游客', 0, 0),
  ('free', '免费', 0, 10),
  ('basic', '基础', 5, 20),
  ('plus', 'Plus', 10, 30),
  ('max', 'Max', 30, 40),
  ('admin', '管理员', 0, 100)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_cny = excluded.price_cny,
  sort_order = excluded.sort_order;

insert into public.quota_plan_limits (plan_id, metric_key, allowance, window_type)
values
  ('guest', 'guest_lookup', 10, 'day'),
  ('free', 'lookup_generation', 30, 'day'),
  ('free', 'deep_reading', 20, 'month'),
  ('basic', 'lookup_generation', 80, 'day'),
  ('basic', 'deep_reading', 150, 'month'),
  ('plus', 'lookup_generation', 200, 'day'),
  ('plus', 'deep_reading', 500, 'month'),
  ('max', 'lookup_generation', 600, 'day'),
  ('max', 'deep_reading', 2000, 'month'),
  ('admin', 'lookup_generation', 1000000, 'day'),
  ('admin', 'deep_reading', 1000000, 'month')
on conflict (plan_id, metric_key) do nothing;

insert into public.account_settings (key, value)
values
  ('quota_timezone', '"Asia/Shanghai"'::jsonb),
  ('guest_cookie_days', '30'::jsonb),
  ('session_inactivity_days', '30'::jsonb),
  ('translation_chars_per_point', '1000'::jsonb),
  ('summary_base_points', '2'::jsonb),
  ('ocr_points_per_image', '5'::jsonb),
  ('global_monthly_budget_microusd', '50000000'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_account_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists account_profiles_set_updated_at on public.account_profiles;
create trigger account_profiles_set_updated_at
before update on public.account_profiles
for each row execute function public.set_account_updated_at();

drop trigger if exists quota_plans_set_updated_at on public.quota_plans;
create trigger quota_plans_set_updated_at
before update on public.quota_plans
for each row execute function public.set_account_updated_at();

drop trigger if exists user_entitlements_set_updated_at on public.user_entitlements;
create trigger user_entitlements_set_updated_at
before update on public.user_entitlements
for each row execute function public.set_account_updated_at();

create or replace function public.create_context_reader_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_profiles (user_id, email, nickname)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nickname', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (user_id) do nothing;

  insert into public.user_entitlements (user_id, plan_id, source)
  values (new.id, 'free', 'signup')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists context_reader_auth_user_created on auth.users;
create trigger context_reader_auth_user_created
after insert on auth.users
for each row execute function public.create_context_reader_account();

create or replace function public.consume_usage(
  p_action_id uuid,
  p_owner_key text,
  p_user_id uuid,
  p_guest_id uuid,
  p_plan_id text,
  p_feature text,
  p_metric_key text,
  p_units bigint default 1
)
returns table (
  allowed boolean,
  used_units bigint,
  allowance bigint,
  window_end timestamptz,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.usage_actions%rowtype;
  v_allowance bigint;
  v_window_type text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_current bigint;
  v_bonus bigint := 0;
  v_timezone text := 'Asia/Shanghai';
begin
  perform pg_advisory_xact_lock(hashtext(p_action_id::text));
  select * into v_existing from public.usage_actions where id = p_action_id;
  if found then
    select coalesce(uc.used_units, 0), qpl.allowance, uc.window_end
      into v_current, v_allowance, v_window_end
    from public.quota_plan_limits qpl
    left join public.usage_counters uc
      on uc.owner_key = v_existing.owner_key
      and uc.metric_key = v_existing.metric_key
      and uc.window_start = v_existing.counter_window_start
    where qpl.plan_id = v_existing.plan_id and qpl.metric_key = v_existing.metric_key;
    return query select true, coalesce(v_current, 0), coalesce(v_allowance, 0), v_window_end, true;
    return;
  end if;

  select qpl.allowance, qpl.window_type
    into v_allowance, v_window_type
  from public.quota_plan_limits qpl
  where qpl.plan_id = p_plan_id and qpl.metric_key = p_metric_key;

  if v_allowance is null then
    return query select false, 0::bigint, 0::bigint, now(), false;
    return;
  end if;

  if p_user_id is not null then
    select coalesce((ue.bonus_limits ->> p_metric_key)::bigint, 0)
      into v_bonus
    from public.user_entitlements ue
    where ue.user_id = p_user_id;
    v_allowance := v_allowance + greatest(0, coalesce(v_bonus, 0));
  end if;

  select coalesce(value #>> '{}', 'Asia/Shanghai')
    into v_timezone
  from public.account_settings
  where key = 'quota_timezone';

  if v_window_type = 'month' then
    v_window_start := (date_trunc('month', now() at time zone v_timezone) at time zone v_timezone);
    v_window_end := ((date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone);
  else
    v_window_start := (date_trunc('day', now() at time zone v_timezone) at time zone v_timezone);
    v_window_end := ((date_trunc('day', now() at time zone v_timezone) + interval '1 day') at time zone v_timezone);
  end if;

  insert into public.usage_counters (owner_key, metric_key, window_start, window_end, used_units)
  values (p_owner_key, p_metric_key, v_window_start, v_window_end, 0)
  on conflict (owner_key, metric_key, window_start) do nothing;

  select uc.used_units into v_current
  from public.usage_counters uc
  where uc.owner_key = p_owner_key
    and uc.metric_key = p_metric_key
    and uc.window_start = v_window_start
  for update;

  if v_current + greatest(p_units, 0) > v_allowance then
    return query select false, v_current, v_allowance, v_window_end, false;
    return;
  end if;

  update public.usage_counters
  set used_units = used_units + greatest(p_units, 0), updated_at = now()
  where owner_key = p_owner_key
    and metric_key = p_metric_key
    and window_start = v_window_start
  returning usage_counters.used_units into v_current;

  insert into public.usage_actions (
    id, owner_key, user_id, guest_id, plan_id, feature, metric_key, quota_units, counter_window_start
  ) values (
    p_action_id, p_owner_key, p_user_id, p_guest_id, p_plan_id, p_feature, p_metric_key,
    greatest(p_units, 0), v_window_start
  );

  return query select true, v_current, v_allowance, v_window_end, false;
end;
$$;

create or replace function public.finalize_usage(
  p_action_id uuid,
  p_status text,
  p_cache_hit boolean default false,
  p_error_code text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usage_actions
  set status = case when p_status in ('succeeded', 'cached', 'failed', 'cancelled') then p_status else 'failed' end,
      cache_hit = p_cache_hit,
      error_code = left(coalesce(p_error_code, ''), 120),
      completed_at = now()
  where id = p_action_id and status = 'reserved';
end;
$$;

create or replace function public.refund_usage(
  p_action_id uuid,
  p_status text default 'failed',
  p_error_code text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.usage_actions%rowtype;
begin
  select * into v_action from public.usage_actions where id = p_action_id for update;
  if not found or v_action.status <> 'reserved' then
    return;
  end if;

  update public.usage_counters
  set used_units = greatest(0, used_units - v_action.quota_units), updated_at = now()
  where owner_key = v_action.owner_key
    and metric_key = v_action.metric_key
    and window_start = v_action.counter_window_start;

  update public.usage_actions
  set status = case when p_status = 'cancelled' then 'cancelled' else 'failed' end,
      error_code = left(coalesce(p_error_code, ''), 120),
      completed_at = now()
  where id = p_action_id;
end;
$$;

create or replace function public.merge_user_data_objects(
  p_user_id uuid,
  p_objects jsonb
)
returns table (
  kind text,
  object_key text,
  payload jsonb,
  client_updated_at timestamptz,
  server_version bigint,
  deleted_at timestamptz,
  accepted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_row public.user_data_objects%rowtype;
  v_expected_version bigint;
begin
  if jsonb_typeof(p_objects) <> 'array' then
    raise exception 'p_objects must be a JSON array';
  end if;

  for v_item in select value from jsonb_array_elements(p_objects)
  loop
    v_expected_version := greatest(0, coalesce((v_item ->> 'serverVersion')::bigint, 0));
    v_row := null;

    insert into public.user_data_objects (
      user_id, kind, object_key, payload, client_updated_at, server_version, deleted_at, updated_at
    ) values (
      p_user_id,
      v_item ->> 'kind',
      v_item ->> 'objectKey',
      coalesce(v_item -> 'payload', '{}'::jsonb),
      coalesce((v_item ->> 'clientUpdatedAt')::timestamptz, now()),
      1,
      nullif(v_item ->> 'deletedAt', '')::timestamptz,
      now()
    )
    on conflict (user_id, kind, object_key) do update
      set payload = excluded.payload,
          client_updated_at = excluded.client_updated_at,
          server_version = public.user_data_objects.server_version + 1,
          deleted_at = excluded.deleted_at,
          updated_at = now()
      where public.user_data_objects.server_version = v_expected_version
    returning * into v_row;

    if v_row.user_id is null then
      select * into v_row
      from public.user_data_objects current_row
      where current_row.user_id = p_user_id
        and current_row.kind = v_item ->> 'kind'
        and current_row.object_key = v_item ->> 'objectKey';
      return query select v_row.kind, v_row.object_key, v_row.payload, v_row.client_updated_at,
        v_row.server_version, v_row.deleted_at, false;
    else
      return query select v_row.kind, v_row.object_key, v_row.payload, v_row.client_updated_at,
        v_row.server_version, v_row.deleted_at, true;
    end if;
  end loop;
end;
$$;

alter table public.account_profiles enable row level security;
alter table public.quota_plans enable row level security;
alter table public.quota_plan_limits enable row level security;
alter table public.account_settings enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.guest_identities enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_actions enable row level security;
alter table public.usage_executions enable row level security;
alter table public.user_data_objects enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists account_profiles_read_own on public.account_profiles;
create policy account_profiles_read_own on public.account_profiles
for select to authenticated using (auth.uid() = user_id);

drop policy if exists account_profiles_update_own on public.account_profiles;
create policy account_profiles_update_own on public.account_profiles
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_entitlements_read_own on public.user_entitlements;
create policy user_entitlements_read_own on public.user_entitlements
for select to authenticated using (auth.uid() = user_id);

drop policy if exists usage_actions_read_own on public.usage_actions;
create policy usage_actions_read_own on public.usage_actions
for select to authenticated using (auth.uid() = user_id);

drop policy if exists usage_executions_read_own on public.usage_executions;
create policy usage_executions_read_own on public.usage_executions
for select to authenticated using (
  exists (
    select 1 from public.usage_actions ua
    where ua.id = usage_executions.action_id and ua.user_id = auth.uid()
  )
);

drop policy if exists user_data_objects_own on public.user_data_objects;
create policy user_data_objects_own on public.user_data_objects
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.account_profiles from anon, public;
revoke all on public.quota_plans from anon, public;
revoke all on public.quota_plan_limits from anon, public;
revoke all on public.account_settings from anon, public;
revoke all on public.user_entitlements from anon, public;
revoke all on public.guest_identities from anon, authenticated, public;
revoke all on public.usage_counters from anon, authenticated, public;
revoke all on public.usage_actions from anon, public;
revoke all on public.usage_executions from anon, public;
revoke all on public.user_data_objects from anon, public;
revoke all on public.admin_audit_logs from anon, authenticated, public;
revoke all on function public.merge_user_data_objects(uuid, jsonb) from anon, authenticated, public;
revoke all on function public.consume_usage(uuid, text, uuid, uuid, text, text, text, bigint) from anon, authenticated, public;
revoke all on function public.finalize_usage(uuid, text, boolean, text) from anon, authenticated, public;
revoke all on function public.refund_usage(uuid, text, text) from anon, authenticated, public;
grant execute on function public.consume_usage(uuid, text, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.finalize_usage(uuid, text, boolean, text) to service_role;
grant execute on function public.refund_usage(uuid, text, text) to service_role;
grant execute on function public.merge_user_data_objects(uuid, jsonb) to service_role;

grant select, update on public.account_profiles to authenticated;
grant select on public.user_entitlements to authenticated;
grant select on public.usage_actions to authenticated;
grant select on public.usage_executions to authenticated;
grant select, insert, update, delete on public.user_data_objects to authenticated;
