-- Additive, reversible application rollout. No existing Anki or usage function is replaced.
begin;
create table if not exists public.study_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.study_cards (
 user_id uuid not null references auth.users(id) on delete cascade, id text not null,
 entry_id text not null, mode text not null, memory jsonb not null, version bigint not null default 0,
 suspended boolean not null default false, anki_pending boolean not null default false,
 created_at timestamptz not null default now(), presentation_id uuid, shown_at timestamptz,
 primary key(user_id,id)
);
create table if not exists public.study_reviews (
 user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 card_id text not null, answer text not null check(answer in ('forgot','unsure_wrong','unsure_right','remembered')),
 rating integer not null check(rating between 1 and 4), reviewed_at timestamptz not null default now(),
 active_ms integer not null check(active_ms between 0 and 60000), undone boolean not null default false,
 previous jsonb not null, next jsonb not null, algorithm text not null, parameters jsonb not null,
 version bigint not null, primary key(user_id,id), foreign key(user_id,card_id) references study_cards(user_id,id)
);
create index if not exists study_reviews_history on public.study_reviews(user_id,reviewed_at desc);
alter table public.study_cards add column if not exists reward_key text;
create table if not exists public.study_days (
 user_id uuid not null references auth.users(id) on delete cascade, day date not null,
 card_ids jsonb not null, settings jsonb not null, reward_points integer not null default 0,
 completed_at timestamptz, primary key(user_id,day)
);
create table if not exists public.study_policy (
 id boolean primary key default true check(id),
 policy jsonb not null default '{"rewardsEnabled":true,"pointsPerNew":1,"dailyRewardCap":50,"rewardDays":90,"streakMinNew":5,"profileEnabled":true,"profileCost":5,"minimumReadingMinutes":60,"minimumLookups":50,"milestones":[{"days":2,"points":50,"plan":null,"months":0},{"days":3,"points":100,"plan":null,"months":0},{"days":7,"points":500,"plan":null,"months":0},{"days":21,"points":1000,"plan":null,"months":0},{"days":30,"points":0,"plan":"basic","months":1},{"days":60,"points":0,"plan":"plus","months":2},{"days":180,"points":0,"plan":"plus","months":6},{"days":365,"points":0,"plan":"max","months":12}]}'
);
insert into study_policy(id) values(true) on conflict do nothing;
alter table public.study_days add column if not exists new_ids jsonb not null default '[]';
alter table public.study_days add column if not exists new_completed integer not null default 0;
alter table public.study_days add column if not exists streak integer not null default 0;
create table if not exists public.study_streaks (
 user_id uuid primary key references auth.users(id) on delete cascade,
 current integer not null default 0,best integer not null default 0,last_day date
);
create table if not exists public.study_reward_words (
 user_id uuid not null references auth.users(id) on delete cascade,reward_key text not null,
 learned_day date not null,card_id text not null,primary key(user_id,reward_key)
);
create table if not exists public.study_rewards (
 user_id uuid not null references auth.users(id) on delete cascade,milestone integer not null,
 points integer not null default 0,plan text,months integer not null default 0,
 earned_at timestamptz not null default now(),activated_at timestamptz,ends_at timestamptz,
 primary key(user_id,milestone)
);
create table if not exists public.study_reading_days (
 user_id uuid not null references auth.users(id) on delete cascade, day date not null,
 active_seconds integer not null default 0, words jsonb not null default '[]', articles jsonb not null default '[]',
 last_tick timestamptz not null default now(), primary key(user_id,day)
);
create table if not exists public.study_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade, result jsonb not null,
 created_at timestamptz not null default now(), evidence jsonb not null, action_id uuid not null
);
create or replace function public.study_start(p_user uuid,p_ids jsonb,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; result study_days%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then raise exception 'study paused'; end if;
 if jsonb_array_length(p_ids)>350 or exists(select 1 from jsonb_array_elements_text(p_ids) x where not exists(select 1 from study_cards c where c.user_id=p_user and c.id=x and not c.suspended)) then raise exception 'invalid study plan'; end if;
 insert into study_days(user_id,day,card_ids,new_ids,settings)
 select p_user,d,p_ids,coalesce(jsonb_agg(id) filter(where (memory->>'state')::int=0),'[]'),p_settings
 from study_cards where user_id=p_user and p_ids ? id on conflict do nothing;
 select * into result from study_days where user_id=p_user and day=d;
 return to_jsonb(result);
end $$;
create or replace function public.study_pause(p_user uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 insert into study_settings(user_id,settings) values(p_user,p_settings)
 on conflict(user_id) do update set settings=p_settings,updated_at=now();
 update study_streaks set current=0,last_day=null where user_id=p_user;
end $$;
create or replace function public.study_present(p_user uuid,p_card text,p_version bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c study_cards%rowtype; token uuid := gen_random_uuid();
begin
 select * into c from study_cards where user_id=p_user and id=p_card for update;
 if not found or c.version<>p_version or c.suspended then return '{"conflict":true}'; end if;
 if (c.memory->>'due')::timestamptz>now() then return '{"notDue":true}'; end if;
 if not exists(select 1 from study_days where user_id=p_user and day=(now() at time zone 'Asia/Shanghai')::date and card_ids ? p_card) then return '{"notPlanned":true}'; end if;
 if exists(select 1 from study_days d join study_cards r on r.user_id=d.user_id and d.card_ids ? r.id
   where d.user_id=p_user and d.day=(now() at time zone 'Asia/Shanghai')::date and d.new_ids ? p_card
   and not d.new_ids ? r.id and not r.suspended and ((r.memory->>'state')::int<>2
   or coalesce((r.memory->>'last_review')::timestamptz,'1970-01-01')<d.day::timestamp at time zone 'Asia/Shanghai'
   or (r.memory->>'due')::timestamptz<(d.day+1)::timestamp at time zone 'Asia/Shanghai')) then return '{"reviewsFirst":true}';end if;
 update study_cards set presentation_id=token,shown_at=now() where user_id=p_user and id=p_card;
 return jsonb_build_object('token',token,'shownAt',now());
end $$;
create or replace function public.study_review(p_user uuid,p_id uuid,p_card text,p_version bigint,p_token uuid,p_answer text,p_rating integer,p_active integer,p_memory jsonb,p_algorithm text,p_parameters jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c study_cards%rowtype; previous_review study_reviews%rowtype; elapsed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into previous_review from study_reviews where user_id=p_user and id=p_id;
 if found then
  if previous_review.card_id<>p_card or previous_review.answer<>p_answer then raise exception 'review id reused'; end if;
  return jsonb_build_object('duplicate',true,'review',to_jsonb(previous_review));
 end if;
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then return '{"paused":true}'; end if;
 select * into c from study_cards where user_id=p_user and id=p_card for update;
 if not found or c.version<>p_version or c.presentation_id is distinct from p_token or c.suspended then return '{"conflict":true}'; end if;
 if not exists(select 1 from study_days where user_id=p_user and day=(now() at time zone 'Asia/Shanghai')::date and card_ids ? p_card) then return '{"dayChanged":true}'; end if;
 if exists(select 1 from study_days d join study_cards r on r.user_id=d.user_id and d.card_ids ? r.id
   where d.user_id=p_user and d.day=(now() at time zone 'Asia/Shanghai')::date and d.new_ids ? p_card
   and not d.new_ids ? r.id and not r.suspended and ((r.memory->>'state')::int<>2
   or coalesce((r.memory->>'last_review')::timestamptz,'1970-01-01')<d.day::timestamp at time zone 'Asia/Shanghai'
   or (r.memory->>'due')::timestamptz<(d.day+1)::timestamp at time zone 'Asia/Shanghai')) then return '{"reviewsFirst":true}';end if;
 if p_rating <> (case p_answer when 'forgot' then 1 when 'unsure_wrong' then 1 when 'unsure_right' then 2 when 'remembered' then 3 else 0 end) then raise exception 'invalid recall outcome'; end if;
 elapsed:=greatest(0,floor(extract(epoch from(now()-c.shown_at))*1000));
 if elapsed<800 then return '{"tooFast":true}'; end if;
 if (select count(*) from study_reviews where user_id=p_user and reviewed_at>now()-interval '1 minute')>=45 then raise exception 'review rate exceeded'; end if;
 insert into study_reviews(user_id,id,card_id,answer,rating,active_ms,previous,next,algorithm,parameters,version)
 values(p_user,p_id,p_card,p_answer,p_rating,least(60000,greatest(0,p_active),elapsed),c.memory,p_memory,p_algorithm,p_parameters,c.version+1);
 update study_cards set memory=p_memory,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=p_card;
 return '{"saved":true}';
end $$;
create or replace function public.study_undo(p_user uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r study_reviews%rowtype; c study_cards%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into r from study_reviews where user_id=p_user and id=p_id for update;
 if not found then return '{"missing":true}'; end if;
 if r.undone then return '{"duplicate":true}'; end if;
 if exists(select 1 from study_days where user_id=p_user and day=(r.reviewed_at at time zone 'Asia/Shanghai')::date and completed_at is not null) then return '{"settled":true}';end if;
 select * into c from study_cards where user_id=p_user and id=r.card_id for update;
 if c.version<>r.version then return '{"conflict":true}'; end if;
 if r.reviewed_at<now()-interval '15 minutes' then return '{"expired":true}'; end if;
 update study_cards set memory=r.previous,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=r.card_id;
 update study_reviews set undone=true where user_id=p_user and id=p_id;
 return '{"saved":true}';
end $$;
create or replace function public.study_daily_stats(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(x order by x.day),'[]') from (
 select (reviewed_at at time zone 'Asia/Shanghai')::date as day,count(distinct card_id) as cards,
 sum(active_ms) as active_ms,count(*) filter(where rating>1) as successes,count(*) as reviews
 from study_reviews where user_id=p_user and not undone and reviewed_at>now()-interval '90 days'
 group by 1) x
$$;
create or replace function public.study_complete(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d study_days%rowtype; p jsonb; pts integer; g uuid; cnt integer; streak_count integer:=0; s study_streaks%rowtype;
 milestone jsonb; bonus integer:=0; inserted integer; current_day date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into d from study_days where user_id=p_user and day=current_day for update;
 if not found or jsonb_array_length(d.card_ids)=0 then return '{"complete":false}'; end if;
 -- Deleted vocabulary is excluded by reconciliation, never counts towards a reward.
 if exists(select 1 from study_cards c where c.user_id=p_user and d.card_ids ? c.id and not c.suspended and (
 coalesce((c.memory->>'last_review')::timestamptz,'1970-01-01') < current_day::timestamp at time zone 'Asia/Shanghai'
 or (c.memory->>'state')::integer<>2
 or (c.memory->>'due')::timestamptz < (current_day+1)::timestamp at time zone 'Asia/Shanghai')) then return '{"complete":false}'; end if;
 if d.completed_at is not null then return jsonb_build_object('complete',true,'points',d.reward_points,'duplicate',true); end if;
 select policy into p from study_policy where id;
 -- A word earns a new-word reward only once, even after delete/re-add or a new card direction.
 insert into study_reward_words(user_id,reward_key,learned_day,card_id)
 select p_user,coalesce(c.reward_key,c.id),current_day,c.id from study_cards c
 where c.user_id=p_user and d.new_ids ? c.id and not c.suspended on conflict do nothing;
 get diagnostics cnt=row_count;
 insert into study_streaks(user_id) values(p_user) on conflict do nothing;
 select * into s from study_streaks where user_id=p_user for update;
 if cnt>=coalesce((p->>'streakMinNew')::int,5) then
   streak_count:=case when s.last_day=current_day-1 then s.current+1 else 1 end;
   update study_streaks set current=streak_count,best=greatest(best,streak_count),last_day=current_day where user_id=p_user;
 end if;
 pts:=case when (p->>'rewardsEnabled')::boolean then least((p->>'dailyRewardCap')::integer,cnt*(p->>'pointsPerNew')::integer) else 0 end;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 g:=billing_ensure(p_user);
 if (p->>'rewardsEnabled')::boolean and g is not null then
   for milestone in select value from jsonb_array_elements(p->'milestones') loop
     if (milestone->>'days')::int<=streak_count then
       insert into study_rewards(user_id,milestone,points,plan,months)
       values(p_user,(milestone->>'days')::int,(milestone->>'points')::int,milestone->>'plan',(milestone->>'months')::int)
       on conflict do nothing;
       get diagnostics inserted=row_count;
       if inserted=1 then bonus:=bonus+(milestone->>'points')::int;end if;
     end if;
   end loop;
 end if;
 pts:=pts+bonus;
 if pts>0 and g is not null then
   insert into billing_grants(user_id,plan_id,starts_at,ends_at,points,kind,grant_key)
   select p_user,plan_id,now(),now()+make_interval(days=>(p->>'rewardDays')::integer),pts,'topup','study:'||p_user||':'||current_day from billing_grants where id=g
   on conflict(grant_key) do nothing;
 else pts:=0; end if;
 update study_days set completed_at=now(),reward_points=pts,new_completed=cnt,streak=streak_count where user_id=p_user and day=current_day;
 return jsonb_build_object('complete',true,'points',pts,'newWords',cnt,'streak',streak_count);
end $$;
-- Membership vouchers preserve existing paid/Admin entitlements; activation never downgrades a plan.
create or replace function public.study_activate_membership(p_user uuid,p_milestone integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r study_rewards%rowtype;e user_entitlements%rowtype;b timestamptz;z timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 select * into r from study_rewards where user_id=p_user and milestone=p_milestone for update;
 if not found or r.plan is null then return '{"missing":true}';end if;
 if r.activated_at is not null then return jsonb_build_object('activated',true,'duplicate',true,'endsAt',r.ends_at);end if;
 select * into e from user_entitlements where user_id=p_user for update;
 if e.plan_id='admin' or (e.plan_id<>'free' and (e.ends_at is null or e.ends_at>now()) and e.plan_id<>r.plan)
 then return '{"existingPlan":true}';end if;
 if e.plan_id=r.plan and e.ends_at>now() then
   b:=e.starts_at;z:=billing_month(e.ends_at,r.months);
   update user_entitlements set ends_at=z where user_id=p_user;
 else
   b:=now();z:=billing_month(b,r.months);
   insert into user_entitlements(user_id,plan_id,source,starts_at,ends_at) values(p_user,r.plan,'promotion',b,z)
   on conflict(user_id) do update set plan_id=excluded.plan_id,source=excluded.source,starts_at=b,ends_at=z;
 end if;
 update study_rewards set activated_at=now(),ends_at=z where user_id=p_user and milestone=p_milestone;
 perform billing_ensure(p_user);
 return jsonb_build_object('activated',true,'endsAt',z);
end $$;
create or replace function public.study_reading_tick(p_user uuid,p_seconds integer,p_words jsonb,p_article text)
returns void language plpgsql security definer set search_path=public as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; r study_reading_days%rowtype; delta integer; merged jsonb;
begin
 insert into study_reading_days(user_id,day) values(p_user,d) on conflict do nothing;
 select * into r from study_reading_days where user_id=p_user and day=d for update;
 delta:=least(30,greatest(0,p_seconds),greatest(0,floor(extract(epoch from(now()-r.last_tick)))));
 select coalesce(jsonb_agg(word),'[]') into merged from (select distinct lower(value) as word from jsonb_array_elements_text(r.words||p_words) where length(value) between 1 and 80 limit 500) words;
 update study_reading_days set active_seconds=least(14400,active_seconds+delta),last_tick=now(),
 words=merged,
 articles=case when length(p_article) between 1 and 160 and jsonb_array_length(articles)<100 and not articles ? p_article then articles||jsonb_build_array(p_article) else articles end
 where user_id=p_user and day=d;
end $$;
create table if not exists public.study_profile_jobs (
 user_id uuid primary key references auth.users(id) on delete cascade, action_id uuid not null,
 expires_at timestamptz not null
);
create or replace function public.study_profile_claim(p_user uuid,p_action uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('study-profile:'||p_user,0));
 if exists(select 1 from study_profile_jobs where user_id=p_user and expires_at>now()) then return '{"claimed":false}'; end if;
 insert into study_profile_jobs(user_id,action_id,expires_at) values(p_user,p_action,now()+interval '2 minutes')
 on conflict(user_id) do update set action_id=p_action,expires_at=now()+interval '2 minutes';
 return '{"claimed":true}';
end $$;
create or replace function public.study_profile_release(p_user uuid,p_action uuid) returns void
language sql security definer set search_path=public as $$
 delete from study_profile_jobs where user_id=p_user and action_id=p_action
$$;
do $$
declare t text; f record;
begin
 foreach t in array array['study_settings','study_cards','study_reviews','study_days','study_policy','study_reading_days','study_profiles','study_profile_jobs','study_streaks','study_reward_words','study_rewards'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('study_start','study_pause','study_present','study_review','study_undo','study_daily_stats','study_complete','study_reading_tick','study_profile_claim','study_profile_release','study_activate_membership') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
