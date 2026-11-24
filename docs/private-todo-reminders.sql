begin;
create table if not exists public.personal_todo_delivery (
  owner_id uuid not null,
  occurrence_key text not null,
  phase text not null check (phase in ('sending','retry','sent','uncertain')),
  dispatch_id uuid not null,
  attempts integer not null default 1,
  next_try timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, occurrence_key)
);
alter table public.personal_todo_delivery enable row level security;
revoke all on public.personal_todo_delivery from public, anon, authenticated;
grant select, insert, update on public.personal_todo_delivery to service_role;

-- Serialize dispatch with workspace updates. Rechecking the revision also covers
-- a changed recipient, a reschedule, a renamed task and edits to reminder settings.
create or replace function public.start_personal_todo_delivery(
  p_owner uuid, p_revision bigint, p_key text, p_task text, p_dispatch uuid
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare s jsonb;
begin
  select w.state into s from public.personal_todo_workspace w
    where w.singleton and w.owner_id=p_owner and w.revision=p_revision for share;
  if s is null or not public.personal_todo_owner_active(p_owner) or s->'settings'->>'emailEnabled' is distinct from 'true'
    or not exists (select 1 from jsonb_array_elements(s->'tasks') t where t->>'id'=p_task)
    or exists (select 1 from jsonb_array_elements(s->'history') h where h->>'key'=p_key)
  then return false; end if;
  insert into public.personal_todo_delivery as d
    (owner_id,occurrence_key,phase,dispatch_id) values (p_owner,p_key,'sending',p_dispatch)
    on conflict(owner_id,occurrence_key) do update
      set phase='sending', dispatch_id=p_dispatch, attempts=d.attempts+1,
          updated_at=clock_timestamp(), next_try=null
      where d.phase='retry' and d.next_try<=clock_timestamp();
  return found;
end;
$$;
create or replace function public.finish_personal_todo_delivery(
  p_owner uuid, p_key text, p_dispatch uuid, p_result text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_result not in ('sent','retry','uncertain') then raise exception 'invalid delivery status'; end if;
  update public.personal_todo_delivery
    set phase=p_result,updated_at=clock_timestamp(),
        next_try=case when p_result='retry' then clock_timestamp()+interval '1 minute'*least(30, power(2,least(5,attempts-1))::integer) end
    where owner_id=p_owner and occurrence_key=p_key and dispatch_id=p_dispatch and phase='sending';
end;
$$;
revoke all on function public.start_personal_todo_delivery(uuid,bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.finish_personal_todo_delivery(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.start_personal_todo_delivery(uuid,bigint,text,text,uuid) to service_role;
grant execute on function public.finish_personal_todo_delivery(uuid,text,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
