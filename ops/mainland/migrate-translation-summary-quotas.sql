begin;

alter table public.usage_actions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.account_activity_days (
  activity_day date not null,
  owner_key text not null,
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid references public.guest_identities(id) on delete cascade,
  identity_kind text not null check (identity_kind in ('account', 'guest')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (activity_day, owner_key),
  check ((identity_kind = 'account' and user_id is not null) or (identity_kind = 'guest' and guest_id is not null))
);

create index if not exists account_activity_days_last_seen_idx
  on public.account_activity_days (last_seen_at desc);

alter table public.account_activity_days enable row level security;
revoke all on public.account_activity_days from anon, authenticated, public;
grant all on public.account_activity_days to service_role;

insert into public.quota_plan_limits (plan_id, metric_key, allowance, window_type)
values
  ('free', 'article_summary', 10, 'month'),
  ('free', 'full_article_translation', 1, 'month'),
  ('basic', 'article_summary', 75, 'month'),
  ('basic', 'full_article_translation', 5, 'month'),
  ('plus', 'article_summary', 250, 'month'),
  ('plus', 'full_article_translation', 20, 'month'),
  ('max', 'article_summary', 1000, 'month'),
  ('max', 'full_article_translation', 60, 'month'),
  ('admin', 'article_summary', 1000000, 'month'),
  ('admin', 'full_article_translation', 1000000, 'month')
on conflict (plan_id, metric_key) do nothing;

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
    if v_existing.owner_key <> p_owner_key
      or v_existing.feature <> p_feature
      or v_existing.metric_key <> p_metric_key then
      return query select false, 0::bigint, 0::bigint, now(), true;
      return;
    end if;
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

  if v_window_type = 'day' then
    v_window_start := (date_trunc('day', now() at time zone v_timezone) at time zone v_timezone);
    v_window_end := v_window_start + interval '1 day';
  else
    v_window_start := (date_trunc('month', now() at time zone v_timezone) at time zone v_timezone);
    v_window_end := v_window_start + interval '1 month';
  end if;

  insert into public.usage_counters (owner_key, metric_key, window_start, window_end, used_units)
  values (p_owner_key, p_metric_key, v_window_start, v_window_end, 0)
  on conflict (owner_key, metric_key, window_start) do nothing;

  select used_units into v_current
  from public.usage_counters
  where owner_key = p_owner_key and metric_key = p_metric_key and window_start = v_window_start
  for update;

  if v_current + greatest(p_units, 0) > v_allowance then
    return query select false, v_current, v_allowance, v_window_end, false;
    return;
  end if;

  update public.usage_counters as uc
  set used_units = uc.used_units + greatest(p_units, 0), updated_at = now()
  where uc.owner_key = p_owner_key
    and uc.metric_key = p_metric_key
    and uc.window_start = v_window_start
  returning uc.used_units into v_current;

  insert into public.usage_actions (
    id, owner_key, user_id, guest_id, plan_id, feature, metric_key, quota_units, counter_window_start
  ) values (
    p_action_id, p_owner_key, p_user_id, p_guest_id, p_plan_id, p_feature, p_metric_key,
    greatest(p_units, 0), v_window_start
  );

  return query select true, v_current, v_allowance, v_window_end, false;
end;
$$;

drop function if exists public.finalize_usage(uuid, text, boolean, text);
create or replace function public.finalize_usage(
  p_action_id uuid,
  p_status text,
  p_cache_hit boolean default false,
  p_error_code text default '',
  p_refund_cache_hit boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.usage_actions%rowtype;
begin
  select * into v_action
  from public.usage_actions
  where id = p_action_id
  for update;

  if not found or v_action.status <> 'reserved' then
    return;
  end if;

  if p_cache_hit and p_refund_cache_hit and v_action.quota_units > 0 then
    update public.usage_counters
    set used_units = greatest(0, used_units - v_action.quota_units), updated_at = now()
    where owner_key = v_action.owner_key
      and metric_key = v_action.metric_key
      and window_start = v_action.counter_window_start;
  end if;

  update public.usage_actions
  set status = case when p_status in ('succeeded', 'cached', 'failed', 'cancelled') then p_status else 'failed' end,
      cache_hit = p_cache_hit,
      quota_units = case when p_cache_hit and p_refund_cache_hit then 0 else quota_units end,
      error_code = left(coalesce(p_error_code, ''), 120),
      completed_at = now()
  where id = p_action_id;
end;
$$;

revoke all on function public.consume_usage(uuid, text, uuid, uuid, text, text, text, bigint) from anon, authenticated, public;
revoke all on function public.finalize_usage(uuid, text, boolean, text, boolean) from anon, authenticated, public;
grant execute on function public.consume_usage(uuid, text, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.finalize_usage(uuid, text, boolean, text, boolean) to service_role;

notify pgrst, 'reload schema';

commit;
