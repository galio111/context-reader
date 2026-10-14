begin;
create table if not exists public.study_local_events (
 user_id uuid not null references auth.users(id) on delete cascade,id uuid not null,
 event jsonb not null,outcome jsonb not null,received_at timestamptz not null default now(),primary key(user_id,id)
);
alter table public.study_local_events enable row level security;
revoke all on public.study_local_events from public,anon,authenticated;
grant all on public.study_local_events to service_role;

create or replace function public.study_local_event_v1(p_user uuid,p_event jsonb,p_version bigint,p_memory jsonb,p_settings jsonb,p_ids jsonb,p_algorithm text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior study_local_events%rowtype;c study_cards%rowtype;r study_reviews%rowtype;
 eid uuid:=(p_event->>'id')::uuid;at_time timestamptz:=(p_event->>'at')::timestamptz;
 d date:=(at_time at time zone 'Asia/Shanghai')::date;outcome jsonb:='{"saved":true}';fresh jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into prior from study_local_events where user_id=p_user and id=eid;
 if found then
  if prior.event<>p_event then raise exception 'event id reused';end if;
  return prior.outcome||'{"duplicate":true}';
 end if;
 if p_event->>'kind'='settings' then
  insert into study_settings(user_id,settings) values(p_user,p_settings)
  on conflict(user_id) do update set settings=p_settings,updated_at=now();
 elsif p_event->>'kind'='review' then
  select * into c from study_cards where user_id=p_user and id=p_event->>'cardId' for update;
  if not found or c.suspended then outcome:='{"removed":true}';
  elsif (c.memory->>'due')::timestamptz>at_time+interval '1 second' then
   -- A different device may already have advanced this card. Keep the original
   -- event for audit, but never accelerate an undued step or issue duplicate credit.
   outcome:='{"superseded":true}';
  else
   if c.version<>p_version then return '{"retry":true}';end if;
   if c.anki_pending and not coalesce((p_settings->>'includeAnki')::boolean,false) then return '{"blocked":true}';end if;
   if exists(select 1 from study_reviews where user_id=p_user and id=eid) then raise exception 'review id reused';end if;
   select coalesce(jsonb_agg(id),'[]') into fresh from study_cards where user_id=p_user and p_ids ? id and (memory->>'state')::int in(0,1);
   insert into study_days(user_id,day,card_ids,new_ids,settings) values(p_user,d,p_ids,fresh,p_settings||'{"flexibleNew":true,"learningQueue":4}') on conflict do nothing;
   update study_days set card_ids=case when card_ids ? c.id then card_ids else card_ids||jsonb_build_array(c.id) end,
    new_ids=case when (c.memory->>'state')::int in(0,1) and not new_ids ? c.id then new_ids||jsonb_build_array(c.id) else new_ids end
    where user_id=p_user and day=d;
   insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version)
   values(p_user,eid,c.id,p_event->>'answer',case p_event->>'answer' when 'forgot' then 1 when 'unsure_wrong' then 1 when 'unsure_right' then 2 when 'remembered' then 3 end,
    at_time,least(60000,greatest(0,(p_event->>'activeMs')::int)),c.memory,p_memory,p_algorithm,jsonb_build_object('offline',true,'retention',p_settings->'retention'),c.version+1);
   update study_cards set memory=p_memory,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=c.id;
  end if;
 elsif p_event->>'kind'='undo' then
  select * into r from study_reviews where user_id=p_user and id=(p_event->>'reviewId')::uuid for update;
  if not found then outcome:='{"missing":true}';
  elsif not r.undone then
   select * into c from study_cards where user_id=p_user and id=r.card_id for update;
   if c.version<>r.version or at_time<r.reviewed_at or at_time>r.reviewed_at+interval '15 minutes' then outcome:='{"superseded":true}';
   elsif exists(select 1 from study_reward_words where user_id=p_user and learned_day=(r.reviewed_at at time zone 'Asia/Shanghai')::date
    and (card_id=r.card_id or exists(select 1 from study_days where user_id=p_user and day=(r.reviewed_at at time zone 'Asia/Shanghai')::date and not new_ids ? r.card_id))) then outcome:='{"settled":true}';
   else
    update study_cards set memory=r.previous,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=r.card_id;
    update study_reviews set undone=true where user_id=p_user and id=r.id;
   end if;
  end if;
 else raise exception 'invalid event';end if;
 insert into study_local_events(user_id,id,event,outcome) values(p_user,eid,p_event,outcome);
 return outcome;
end $$;
revoke all on function public.study_local_event_v1(uuid,jsonb,bigint,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.study_local_event_v1(uuid,jsonb,bigint,jsonb,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
