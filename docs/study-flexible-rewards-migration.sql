-- Additive study UI/reward flow. Original RPCs remain available for rollback.
begin;
create table if not exists public.study_claims (
 user_id uuid not null references auth.users(id) on delete cascade,
 id text not null,day date,milestone integer,points integer not null default 0 check(points>=0),
 claimed_points integer not null default 0 check(claimed_points>=0 and claimed_points<=points),
 plan text,months integer not null default 0,earned_at timestamptz not null default now(),claimed_at timestamptz,
 primary key(user_id,id)
);
alter table public.study_claims enable row level security;
revoke all on public.study_claims from anon,authenticated,public;
grant all on public.study_claims to service_role;

create or replace function public.study_start_flexible(p_user uuid,p_ids jsonb,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; result study_days%rowtype; ids jsonb;newids jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then raise exception 'study paused';end if;
 if jsonb_array_length(p_ids)>50000 or exists(select 1 from jsonb_array_elements_text(p_ids) x where not exists(select 1 from study_cards c where c.user_id=p_user and c.id=x and not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false)))) then raise exception 'invalid study plan';end if;
 select * into result from study_days where user_id=p_user and day=d for update;
 if found then
  -- Keep today's review target fixed; new words saved later may join without a daily quota.
  select coalesce(jsonb_agg(c.id order by c.created_at,c.id),'[]') into ids from study_cards c
  where c.user_id=p_user and not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false))
  and (result.card_ids ? c.id or (p_ids ? c.id and (c.memory->>'state')::int=0));
  select coalesce(jsonb_agg(c.id),'[]') into newids from study_cards c where c.user_id=p_user and ids ? c.id
  and (result.new_ids ? c.id or (c.memory->>'state')::int=0);
  update study_days set card_ids=ids,new_ids=newids,settings=study_days.settings||'{"flexibleNew":true}' where user_id=p_user and day=d;
 else
  insert into study_days(user_id,day,card_ids,new_ids,settings)
  select p_user,d,p_ids,coalesce(jsonb_agg(id) filter(where (memory->>'state')::int=0),'[]'),p_settings||'{"flexibleNew":true}'
  from study_cards where user_id=p_user and p_ids ? id;
 end if;
 select * into result from study_days where user_id=p_user and day=d;return to_jsonb(result);
end $$;

create or replace function public.study_settle_rewards(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d study_days%rowtype;p jsonb;cnt integer:=0;total_new integer:=0;st integer:=0;s study_streaks%rowtype;
 m jsonb;inserted integer;gain integer:=0;prior integer:=0;target integer:=0;k text;daynow date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then return '{"complete":false,"paused":true}';end if;
 select * into d from study_days where user_id=p_user and day=daynow for update;
 if not found or jsonb_array_length(d.card_ids)=0 then return '{"complete":false}';end if;
 -- All planned old words must finish first. Unfinished new words do not block an earned reward.
 if exists(select 1 from study_cards c where c.user_id=p_user and d.card_ids ? c.id and not d.new_ids ? c.id and not c.suspended and (
  coalesce((c.memory->>'last_review')::timestamptz,'1970-01-01')<daynow::timestamp at time zone 'Asia/Shanghai'
  or (c.memory->>'state')::int<>2 or (c.memory->>'due')::timestamptz<(daynow+1)::timestamp at time zone 'Asia/Shanghai')) then return '{"complete":false}';end if;
 select policy into p from study_policy where id;
 insert into study_reward_words(user_id,reward_key,learned_day,card_id)
 select p_user,coalesce(c.reward_key,c.id),daynow,c.id from study_cards c
 where c.user_id=p_user and d.new_ids ? c.id and not c.suspended
 and (c.memory->>'state')::int=2 and (c.memory->>'last_review')::timestamptz>=daynow::timestamp at time zone 'Asia/Shanghai'
 and (c.memory->>'due')::timestamptz>=(daynow+1)::timestamp at time zone 'Asia/Shanghai' on conflict do nothing;
 get diagnostics cnt=row_count;
 select count(*) into total_new from study_reward_words where user_id=p_user and learned_day=daynow;
 k:='daily:'||daynow;
 if coalesce((p->>'rewardsEnabled')::boolean,false) and cnt>0 then
  select points into prior from study_claims where user_id=p_user and id=k;prior:=coalesce(prior,0);
  target:=greatest(prior,least((p->>'dailyRewardCap')::int,prior+cnt*(p->>'pointsPerNew')::int));
  gain:=target-prior;
  if target>0 then
   insert into study_claims(user_id,id,day,points) values(p_user,k,daynow,target)
   on conflict(user_id,id) do update set points=excluded.points,earned_at=now();
  end if;
 end if;
 insert into study_streaks(user_id) values(p_user) on conflict do nothing;
 select * into s from study_streaks where user_id=p_user for update;st:=s.current;
 if total_new>=coalesce((p->>'streakMinNew')::int,5) then
  st:=case when s.last_day=daynow then s.current when s.last_day=daynow-1 then s.current+1 else 1 end;
  update study_streaks set current=st,best=greatest(best,st),last_day=daynow where user_id=p_user;
  update study_days set completed_at=coalesce(completed_at,now()),streak=st where user_id=p_user and day=daynow;
  if coalesce((p->>'rewardsEnabled')::boolean,false) then
   for m in select value from jsonb_array_elements(p->'milestones') loop
    if (m->>'days')::int<=st then
     insert into study_rewards(user_id,milestone,points,plan,months) values(p_user,(m->>'days')::int,(m->>'points')::int,m->>'plan',(m->>'months')::int) on conflict do nothing;
     get diagnostics inserted=row_count;
     if inserted=1 then
      insert into study_claims(user_id,id,day,milestone,points,plan,months)
      values(p_user,'milestone:'||(m->>'days'),daynow,(m->>'days')::int,(m->>'points')::int,m->>'plan',(m->>'months')::int) on conflict do nothing;
     end if;
    end if;
   end loop;
  end if;
 end if;
 update study_days set new_completed=total_new where user_id=p_user and day=daynow;
 return jsonb_build_object('complete',true,'newWords',cnt,'earnedPoints',gain,'streak',st);
end $$;

create or replace function public.study_claim_reward(p_user uuid,p_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r study_claims%rowtype;delta integer;g uuid;p jsonb;daynow date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into r from study_claims where user_id=p_user and id=p_id for update;
 if not found then return '{"missing":true}';end if;
 delta:=r.points-r.claimed_points;
 if delta=0 and r.claimed_at is not null then return '{"claimed":true,"duplicate":true,"points":0}';end if;
 if delta>0 then
  perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));g:=billing_ensure(p_user);
  if g is null then return '{"unavailable":true}';end if;
  select policy into p from study_policy where id;
  insert into billing_grants(user_id,plan_id,starts_at,ends_at,points,kind,grant_key)
  select p_user,plan_id,now(),now()+make_interval(days=>(p->>'rewardDays')::int),delta,'topup','study-claim:'||p_user||':'||p_id||':'||r.points from billing_grants where id=g
  on conflict(grant_key) do nothing;
 end if;
 update study_claims set claimed_points=points,claimed_at=now() where user_id=p_user and id=p_id;
 if r.day is not null then update study_days set reward_points=reward_points+delta where user_id=p_user and day=r.day;end if;
 return jsonb_build_object('claimed',true,'points',delta);
end $$;

-- An earned word is settled, but later unearned answers may still be undone.
create or replace function public.study_undo_flexible(p_user uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r study_reviews%rowtype;c study_cards%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into r from study_reviews where user_id=p_user and id=p_id for update;
 if not found then return '{"missing":true}';end if;
 if r.undone then return '{"duplicate":true}';end if;
 if exists(select 1 from study_reward_words where user_id=p_user and card_id=r.card_id and learned_day=(r.reviewed_at at time zone 'Asia/Shanghai')::date) then return '{"settled":true}';end if;
 select * into c from study_cards where user_id=p_user and id=r.card_id for update;
 if c.version<>r.version then return '{"conflict":true}';end if;
 if r.reviewed_at<now()-interval '15 minutes' then return '{"expired":true}';end if;
 -- Old reviews that already enabled a reward cannot be turned into unfinished prerequisites.
 if exists(select 1 from study_days d where d.user_id=p_user and d.day=(r.reviewed_at at time zone 'Asia/Shanghai')::date and not d.new_ids ? r.card_id
 and exists(select 1 from study_reward_words w where w.user_id=p_user and w.learned_day=d.day)) then return '{"settled":true}';end if;
 update study_cards set memory=r.previous,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=r.card_id;
 update study_reviews set undone=true where user_id=p_user and id=p_id;
 return '{"saved":true}';
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname in('study_start_flexible','study_settle_rewards','study_claim_reward','study_undo_flexible') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
