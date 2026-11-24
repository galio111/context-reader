\set ON_ERROR_STOP on
-- Caller sets psql todo_owner_id to one independently verified active developer UUID.
-- Omitting it or changing an existing owner aborts the transaction.
begin;
create table if not exists public.personal_todo_workspace (
  singleton boolean primary key default true check (singleton),
  owner_id uuid unique not null references auth.users(id),
  revision bigint not null default 0 check (revision >= 0),
  import_keys text[] not null default '{}',
  state jsonb not null check (jsonb_typeof(state) = 'object')
);
alter table public.personal_todo_workspace enable row level security;
revoke all on public.personal_todo_workspace from public, anon, authenticated, service_role;
grant select, update (revision, state) on public.personal_todo_workspace to service_role;

create or replace function public.personal_todo_owner_active(p_user_id uuid) returns boolean
language sql stable security invoker set search_path = pg_catalog, public as $$
  select exists(
    select 1 from public.personal_todo_workspace w
    join public.account_profiles p on p.user_id = w.owner_id
    join public.user_entitlements e on e.user_id = w.owner_id
    where w.singleton and w.owner_id = p_user_id and p.status = 'active' and e.plan_id = 'admin'
      and (e.starts_at is null or e.starts_at <= now()) and (e.ends_at is null or e.ends_at > now())
  )
$$;
revoke all on function public.personal_todo_owner_active(uuid) from public, anon, authenticated;
grant execute on function public.personal_todo_owner_active(uuid) to service_role;

insert into public.personal_todo_workspace (owner_id, state) values (:'todo_owner_id'::uuid,
'{"version":1,"categories":["学习","生活","班级事务","个人项目"],"tasks":[],"history":[],"settings":{"learnDefaults":true,"defaultMissed":"skip","emailEnabled":false,"emailAddress":"","remindMinutes":60,"allDayTime":"18:00"}}'::jsonb)
on conflict(singleton) do nothing;
-- Abort atomically if the principal is ambiguous, inactive or would replace the bound owner.
select 1 / (public.personal_todo_owner_active(:'todo_owner_id'::uuid))::integer as owner_verified;
notify pgrst, 'reload schema';
commit;
